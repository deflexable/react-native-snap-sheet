import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, cloneElement, Fragment } from "react";
import { Animated, findNodeHandle, PanResponder, StyleSheet, UIManager, useAnimatedValue, View } from "react-native";
import { DodgeKeyboard } from "react-native-dodge-keyboard";
import { doRendable, isNumber, isPositiveNumber } from "./utils";
import { styling } from "./styling";
import MutateReact, { createMutantElement } from "mutate-react";

const PixelRate = 70 / 100; // 70ms to 100 pixels
const CheckFocusedNode = '__fakeSnapSheetFocused';

const SnapSheet = forwardRef(function SnapSheet({
    snapPoints = [],
    initialSnapIndex = 0,
    minSnapIndex = 0,
    onSnapIndex,
    onSnapFinish,
    snapWhileDecelerating = false,
    style,
    inheritScrollVelocityOnExpand,
    inheritScrollVelocityOnCollapse,
    renderHandle,
    handleColor,
    isHandleOutside,
    keyboardDodgingBehaviour = 'optimum',
    keyboardDodgingOffset,
    children,
    disabled,
    currentAnchorId,
    __forceDisableDodging,
    _perceivedDodgeInputSize,
    __checkIfElementIsFocused,
    __loosenMinSnap
}, ref) {
    const isLift = keyboardDodgingBehaviour === 'whole';

    if (!['optimum', 'whole', 'off'].includes(keyboardDodgingBehaviour))
        throw `keyboardDodgingBehaviour must be any of ${['optimum', 'whole', 'off']} but got ${keyboardDodgingBehaviour}`;

    if (__forceDisableDodging && keyboardDodgingBehaviour !== 'off')
        throw `__forceDisableDodging requires setting keyboardDodgingBehaviour to 'off'`;

    if (snapPoints.length < 2) throw new Error('snapPoints must have at least two items');
    snapPoints.forEach((v, i, a) => {
        if (typeof v !== 'number' || !isNumber(v))
            throw new Error(`snapPoints must have a valid number but got ${v} at position ${i}`);
        if (i !== a.length - 1 && v >= a[i + 1])
            throw new Error(`snapPoints must be in accending order but got ${v} before ${a[i + 1]}`);
    });
    if (!Number.isInteger(initialSnapIndex) || initialSnapIndex < 0)
        throw new Error(`initialSnapIndex should be a positive integer but got:${initialSnapIndex}`);
    if (initialSnapIndex >= snapPoints.length) throw new Error(`initialSnapIndex is out of range`);

    if (!Number.isInteger(minSnapIndex) || minSnapIndex < 0)
        throw new Error(`minSnapIndex should be a positive integer but got:${minSnapIndex}`);

    if (minSnapIndex >= snapPoints.length) throw new Error(`minSnapIndex is out of range`);
    initialSnapIndex = Math.max(initialSnapIndex, minSnapIndex);

    if (__checkIfElementIsFocused !== undefined && typeof __checkIfElementIsFocused !== 'function')
        throw `expected '__checkIfElementIsFocused' to be a function but got ${__checkIfElementIsFocused}`;

    if (isLift) {
        const realChecker = __checkIfElementIsFocused;
        __checkIfElementIsFocused = (r, refs) => {
            return !!r?.[CheckFocusedNode] && refs.some(v => realChecker ? realChecker?.(v, refs) : v?.isFocused?.());
        };
        if (keyboardDodgingOffset === undefined) {
            keyboardDodgingOffset = 0;
        }
    } else if (keyboardDodgingOffset === undefined) {
        keyboardDodgingOffset = 10;
    }

    const flattenStyle = StyleSheet.flatten(style) || {};
    const initSnapPoints = snapPoints;

    const [scrollEnabled, setScrollEnabled] = useState(false);
    const [dodgeOffset, setDodgeOffset] = useState(0);
    const [prefferedAnchor, setPrefferedAnchor] = useState();
    const [parentHeight, setParentHeight] = useState();

    snapPoints = snapPoints.map(v => v + dodgeOffset);
    const snapPointsKey = `${snapPoints}`;

    const fixHeight =
        (isPositiveNumber(flattenStyle.minHeight) && isPositiveNumber(flattenStyle.height))
            ? Math.max(flattenStyle.minHeight, flattenStyle.height)
            : flattenStyle.height;
    const fixMaxHeight = flattenStyle.maxHeight;

    const PotentialHeight =
        (isPositiveNumber(fixHeight) && isPositiveNumber(fixMaxHeight))
            ? Math.min(fixHeight, fixMaxHeight)
            : fixHeight;
    // console.log('sheetLifing:', { extraLift, dodgeOffset, requiredLift, initSnapPoints: `${initSnapPoints}`, snapPoints: `${snapPoints}` });
    const MODAL_HEIGHT =
        isPositiveNumber(PotentialHeight)
            ? PotentialHeight
            : snapPoints.slice(-1)[0] - snapPoints[0];

    const snapTranslateValues = useMemo(() => snapPoints.map(h => MODAL_HEIGHT - h), [snapPointsKey]);

    const translateY = useAnimatedValue(snapTranslateValues[initialSnapIndex], { useNativeDriver: true });

    /**
     * @type {import("react").RefObject<{[key: string]: { ref: import('react-native').ScrollView, scrollY: 0, anchorId: string }}>}
     */
    const scrollRefObj = useRef({});
    /**
     * @type {import("react").RefObject<{[key: string]: { l: number, t: number, w: number, h: number }}>}
     */
    const avoidableSurfaces = useRef({});
    const dodgeRef = useRef();
    const lastOffset = useRef(translateY._value);
    const lastSnapIndex = useRef(initialSnapIndex);
    const instantPrefferAnchor = useRef();
    instantPrefferAnchor.current = prefferedAnchor;

    const prevScrollY = useRef(0);
    const prevTime = useRef(0);

    const instantScrollEnabled = useRef(scrollEnabled);
    instantScrollEnabled.current = scrollEnabled;

    const getCurrentSnap = (draggingUpward) => {
        const shownHeight = MODAL_HEIGHT - translateY._value;
        const currentSnapIndex = draggingUpward ? snapPoints.findIndex((v, i, a) => v <= shownHeight && (i === a.length - 1 || shownHeight < a[i + 1]))
            : snapPoints.findIndex((v, i, a) => v >= shownHeight && (!i || shownHeight > a[i - 1]));

        return currentSnapIndex;
    }

    const snapToIndex = useRef();
    const stillSnapping = useRef();
    const lastSnappingInstance = useRef(0);
    const shouldRefreshDodge = useRef();

    snapToIndex.current = (index, force, velocity, onFinish) => {
        if (disabled && !force) return;

        if (!Number.isInteger(index) || index < 0 || index > snapPoints.length - 1)
            throw new Error(`invalid snap index:${index}, index must be within range 0 - ${snapPoints.length - 1}`);

        if (index < minSnapIndex) index = minSnapIndex;

        const newY = snapTranslateValues[index];

        const prevY = translateY._value;
        setScrollEnabled(index === snapPoints.length - 1);

        // console.log('snapping:', index);
        let wasFinished;
        const guessFinish = () => {
            if (wasFinished) return;
            wasFinished = true;
            onFinish?.();
            onSnapFinish?.(index);
        }
        const pixel = Math.abs(prevY - newY);
        const timeout = pixel * PixelRate;

        const timer = setTimeout(guessFinish, Math.max(300, timeout));
        const thisRef = ++lastSnappingInstance.current;
        stillSnapping.current = true;

        // console.log('snapTimer:', { timeout, pixel }, ' newY:', newY, ' snapPoint:', initSnapPoints, ' snapTrans:', snapTranslateValues);

        Animated.spring(translateY, {
            velocity,
            toValue: newY,
            useNativeDriver: true
        }).start(() => {
            clearTimeout(timer);
            guessFinish();
            if (thisRef === lastSnappingInstance.current) {
                requestIdleCallback(() => {
                    stillSnapping.current = false;
                    if (shouldRefreshDodge.current) {
                        isLifting.current = false;
                        if (dodgeRef.current) dodgeRef.current.trigger();
                    }
                }, { timeout: 700 });
            }
        });

        lastOffset.current = newY;
        lastSnapIndex.current = index;
        onSnapIndex?.(index);
    }

    useImperativeHandle(ref, () => ({
        snap: index => {
            snapToIndex.current(index, true);
        }
    }));

    useEffect(() => {
        if (!isLifting.current) snapToIndex.current(Math.min(lastSnapIndex.current, snapPoints.length - 1), true);
    }, [snapPointsKey]);

    _perceivedDodgeInputSize =
        useMemo(() => {
            if (keyboardDodgingBehaviour !== 'optimum' || __checkIfElementIsFocused) return;
            if (_perceivedDodgeInputSize !== undefined)
                return _perceivedDodgeInputSize;

            if (parentHeight === undefined) {
                return MODAL_HEIGHT * .35;
            }

            return Math.max(0, Math.min(MODAL_HEIGHT * .35, (parentHeight - MODAL_HEIGHT) * .8));
        }, [_perceivedDodgeInputSize, parentHeight, MODAL_HEIGHT, keyboardDodgingBehaviour, !__checkIfElementIsFocused]);

    const panResponder = useMemo(() => {
        // <--- dx negative, dx positive --->
        /**
         * ^
         * |
         * |
         * |
         * dy negative
         * 
         */
        return PanResponder.create({
            onMoveShouldSetPanResponderCapture: (event, gesture) => {
                if (gesture.numberActiveTouches > 1) return false;

                const { scrollY } = scrollRefObj.current[instantPrefferAnchor.current] || {};
                const { pageX, pageY } = event?.nativeEvent || {};

                const sheetX = sheetPlacement.current?.px;
                const sheetY =
                    sheetPlacement.current?.py +
                    sheetPlacement.current?.h +
                    (translateY._value - MODAL_HEIGHT);

                const boundries =
                    Object.entries(avoidableSurfaces.current)
                        .filter(([_, v]) => {
                            if (v?.t === undefined || v?.px === undefined) return false;

                            const y = v.t + sheetY;
                            const x = v.px + sheetX;

                            if (isNaN(y) || isNaN(x)) return false;

                            return pageY >= y &&
                                pageX >= x &&
                                pageY <= (y + v.h) &&
                                pageX <= (x + v.w);
                        });

                if (boundries.length && !boundries.some(v => v[0] === instantPrefferAnchor.current)) {
                    return false;
                }

                const isMovingY = (minChange = 3) =>
                    gesture.dy > minChange &&
                    (Math.abs(gesture.dy) - Math.abs(gesture.dx)) / Math.abs(gesture.dy) >= .7;

                const shouldCapture = !disabled && (
                    !instantScrollEnabled.current ||
                    (scrollY <= 0 && isMovingY(5)) ||
                    (instantPrefferAnchor.current === undefined && isMovingY(7))
                );
                if (shouldCapture) setScrollEnabled(false);

                // console.log('shouldCaptureX:', shouldCapture, ' anchor:', instantPrefferAnchor.current, ' scrollEnable:', instantScrollEnabled.current, ' dy:', gesture.dy, ' scrollY:', scrollY);
                return shouldCapture;
            },
            onPanResponderMove: (_, gesture) => {
                const newY = gesture.dy + lastOffset.current;

                if (
                    newY > snapTranslateValues[__loosenMinSnap ? 0 : minSnapIndex] ||
                    newY < snapTranslateValues.slice(-1)[0]
                ) return;

                translateY.setValue(newY);
            },
            onPanResponderRelease: (_, gesture) => {
                const { dy, vy } = gesture; // when vy is lesser, it is scroll up
                // console.log('onPanResponderRelease:', gesture);

                const draggingUpward = vy <= 0;
                const currentSnapIndex = getCurrentSnap(draggingUpward);

                const newSnapIndex = Math.abs(dy) <= 30 ? currentSnapIndex :
                    draggingUpward ? Math.min(snapPoints.length - 1, currentSnapIndex + 1) :
                        snapWhileDecelerating ? Math.max(0, currentSnapIndex - 1) :
                            vy > 0.3 ? 0 : currentSnapIndex;
                const willFullyShow = newSnapIndex === snapPoints.length - 1;

                snapToIndex.current(newSnapIndex, true, draggingUpward ? vy : undefined);

                // Only scroll if there was a fling velocity upward
                if (inheritScrollVelocityOnExpand && willFullyShow && vy < -0.1) {
                    const newScrollY = Math.min(100, Math.max(0, -vy * 70)); // velocity → scroll inertia
                    const ref = scrollRefObj.current[instantPrefferAnchor.current]?.ref;
                    if (ref) {
                        if (ref.scrollTo) {
                            ref.scrollTo?.({ y: newScrollY, animated: true });
                        } else if (ref.scrollToOffset) {
                            ref.scrollToOffset?.({ offset: newScrollY, animated: true });
                        } else {
                            ref.getScrollResponder?.()?.scrollTo?.({ y: newScrollY, animated: true });
                        }
                    }
                }
            }
        });
    }, [!disabled, snapPointsKey, minSnapIndex, MODAL_HEIGHT]);

    const conStyle = useMemo(() => {
        const { height, minHeight, maxHeight, ...rest } = flattenStyle;

        return {
            backgroundColor: "#fff",
            borderTopLeftRadius: 25,
            borderTopRightRadius: 25,
            zIndex: 1,
            height: (Object.hasOwn(flattenStyle, 'height') && height === undefined) ? undefined : MODAL_HEIGHT,
            ...rest,
            transform: [{ translateY }]
        };
    }, [snapPointsKey, style]);

    const updateAnchorReducer = useRef();

    const scheduleAnchorUpdate = (timeout = 30) => {
        clearTimeout(updateAnchorReducer.current);
        updateAnchorReducer.current = setTimeout(updatePrefferAnchor, timeout);
    }

    const updatePrefferAnchor = () => {
        const anchorList =
            Object.entries(avoidableSurfaces.current)
                .map(([k, v], index) => {
                    if (v?.t === undefined || v?.px === undefined) return false;

                    const o = scrollRefObj.current[k];
                    if (!o) return;

                    return {
                        index,
                        instanceId: k,
                        anchorId: o.anchorId,
                        width: v.w,
                        height: v.h,
                        y: v.t,
                        x: v.px
                    };
                }).filter(v => v);

        const directAnchor =
            currentAnchorId !== undefined &&
            anchorList.find(v => v.anchorId === currentAnchorId);

        if (directAnchor) {
            setPrefferedAnchor(directAnchor.instanceId);
            return;
        }

        if (!sheetSizing.current) return;

        const bestIndex =
            getIndexOfMostVisibleArea(
                sheetSizing.current.w,
                sheetSizing.current.h,
                anchorList
            );

        setPrefferedAnchor(bestIndex === -1 ? undefined : anchorList[bestIndex]?.instanceId);
    }

    useEffect(updatePrefferAnchor, [currentAnchorId]);

    const onAnchorScroll = (e, instanceId) => {
        const scrollY = e.nativeEvent.contentOffset.y;
        scrollRefObj.current[instanceId].scrollY = scrollY;

        // console.log('onAnchorScroll scrollOffset:', scrollY, ' instanceId:', instanceId, ' hasObj:', !!scrollRefObj.current[instanceId]);
        if (!inheritScrollVelocityOnCollapse) {
            prevScrollY.current = 0;
            prevTime.current = 0;
            return;
        }
        const now = Date.now();
        let scrollVelocity = 0;

        if (prevTime.current) {
            const dy = scrollY - prevScrollY.current;
            const dt = now - prevTime.current;

            scrollVelocity = dt > 0 ? dy / dt : 0;
        }

        prevScrollY.current = scrollY;
        prevTime.current = now;

        // Handoff: ScrollView tries to overscroll upward
        if (instantScrollEnabled.current && scrollY <= 0 && scrollVelocity < 0) {
            instantScrollEnabled.current = false;

            const currentSnapIndex = getCurrentSnap(false);
            const newSnapIndex = snapWhileDecelerating ? Math.max(0, currentSnapIndex - 1) : 0;
            snapToIndex.current(newSnapIndex, false, -scrollVelocity);
        }
    }

    const handleDotConStyle =
        useMemo(() => ({
            ...styling.modalHandle,
            ...isHandleOutside ? {
                position: 'absolute',
                width: '100%',
                top: -(styling.modalHandleItem.height + (styling.modalHandle.paddingVertical * 2))
            } : {}
        }), [isHandleOutside]);

    const handleDotStyle =
        useMemo(() => ({
            ...styling.modalHandleItem,
            ...handleColor ? { backgroundColor: handleColor } : {}
        }), [handleColor]);

    const disableDodging = keyboardDodgingBehaviour === 'off';

    const instanceIdIterator = useRef(0);
    const prevKE = useRef();
    const isLifting = useRef();
    const lastLiftInstance = useRef(0);

    const quicklyDodgeKeyboard = async (event) => {
        let { liftUp, keyboardEvent } = event;
        // console.log('quicklyDodgeKeyboard event:', event);

        if (!keyboardEvent) {
            if (!(keyboardEvent = prevKE.current)) return;
        }
        if (keyboardEvent.endCoordinates.height) {
            prevKE.current = keyboardEvent;
        } else {
            if (prevKE.current) keyboardEvent = prevKE.current;
        }
        isLifting.current = true;
        if (stillSnapping.current) {
            if (!liftUp) {
                isLifting.current = false;
                setDodgeOffset(0);
                return;
            }
            shouldRefreshDodge.current = true;
            return;
        }
        const thisRef = ++lastLiftInstance.current;

        const kh = keyboardEvent?.endCoordinates?.height || 0;
        const realSnapPoint = initSnapPoints[lastSnapIndex.current];

        const newY = liftUp ? translateY._value - liftUp : (MODAL_HEIGHT - realSnapPoint);
        const newDodgeOffset = (MODAL_HEIGHT - newY) - realSnapPoint;
        const newDuration = kh > 0 ? (Math.min(Math.abs(liftUp), kh) / kh) * keyboardEvent.duration : 0;

        // console.log('newPosY:', newY, ' timing newDuration:', newDuration, ' newDodgeOffset:', newDodgeOffset);
        Animated.timing(translateY, {
            duration: Math.max((newDuration || 0) - 70, 0),
            toValue: newY,
            useNativeDriver: true
        }).start(() => {
            if (thisRef === lastLiftInstance.current) {
                isLifting.current = false;
                setDodgeOffset(newDodgeOffset);
            }
        });
    }

    const sheetNodeId = useRef();
    /**
     * @type {import("react").RefObject<{ px: number, py: number, w: number, h: number }>}
     */
    const sheetPlacement = useRef();
    const sheetSizing = useRef();

    const DodgeKeyboardComponent = __forceDisableDodging ? Fragment : DodgeKeyboard;

    return (
        <View style={styling.absoluteFill}
            onLayout={e => {
                setParentHeight(e.nativeEvent.layout.height);
            }}>
            <View style={{ position: 'absolute', bottom: 0, width: '100%' }}
                ref={r => {
                    if (r)
                        r.measure((x, y, w, h, px, py) => {
                            sheetPlacement.current = { w, h, px, py };
                        });
                }}
                onLayout={e => {
                    e.currentTarget.measure((x, y, w, h, px, py) => {
                        sheetPlacement.current = { w, h, px, py };
                    });
                }}>
                <Animated.View
                    ref={r => {
                        if (r) sheetNodeId.current = findNodeHandle(r);
                    }}
                    onLayout={e => {
                        e.currentTarget.measure((x, y, w, h, px, py) => {
                            sheetSizing.current = { w, h, px, py };
                            scheduleAnchorUpdate();
                        });
                    }}
                    style={conStyle}
                    {...panResponder.panHandlers}>
                    {doRendable?.(
                        renderHandle,
                        <View style={handleDotConStyle}>
                            <View style={handleDotStyle} />
                        </View>
                    )}
                    <View style={styling.flexer}>
                        <DodgeKeyboardComponent
                            ref={dodgeRef}
                            offset={keyboardDodgingOffset}
                            disabled={disableDodging}
                            checkIfElementIsFocused={__checkIfElementIsFocused}
                            _perceivedDodgeInputSize={_perceivedDodgeInputSize}
                            onHandleDodging={quicklyDodgeKeyboard}>
                            <MutateReact
                                onHandleMutation={node => {
                                    const injectChild = (node, wasNested) => {
                                        if (node?.props?.snap_sheet_scan_off || node?.props?.__checking_snap_scrollable)
                                            return createMutantElement(node);

                                        const thisScrollable = isScrollable(node);
                                        const rootRenderItem = node?.props?.renderItem;

                                        let hasInternalList;

                                        if (!node?.props?.scroll_anchor_snap_avoid && !thisScrollable) {
                                            if (
                                                !wasNested &&
                                                node?.props?.horizontal &&
                                                typeof rootRenderItem === 'function' &&
                                                !node?.props?.children
                                            ) {
                                                hasInternalList = true;
                                            } else return;
                                        }

                                        const renderer = () => {
                                            const instanceId = useMemo(() => `${++instanceIdIterator.current}`, [hasInternalList]);

                                            useEffect(() => {
                                                return () => {
                                                    if (scrollRefObj.current.hasOwnProperty(instanceId)) {
                                                        delete scrollRefObj.current[instanceId];
                                                        scheduleAnchorUpdate();
                                                    }

                                                    if (avoidableSurfaces.current.hasOwnProperty(instanceId)) {
                                                        delete avoidableSurfaces.current[instanceId];
                                                        scheduleAnchorUpdate();
                                                    }
                                                }
                                            }, [hasInternalList]);

                                            if (hasInternalList) {
                                                const newProps = {
                                                    ...node?.props,
                                                    renderItem: (...args) => {
                                                        return (
                                                            <MutateReact onHandleMutation={n => injectChild(n, true)}>
                                                                {rootRenderItem(...args)}
                                                            </MutateReact>
                                                        );
                                                    }
                                                };

                                                return cloneElement(node, newProps);
                                            }

                                            const initNode = () => {
                                                const wasAssigned = scrollRefObj.current.hasOwnProperty(instanceId);

                                                if (!scrollRefObj.current[instanceId])
                                                    scrollRefObj.current[instanceId] = { scrollY: 0 };

                                                const thisAnchorId = node.props?.snap_sheet_scroll_anchor;

                                                if (scrollRefObj.current[instanceId].anchorId !== thisAnchorId || !wasAssigned) {
                                                    scheduleAnchorUpdate(100);
                                                }
                                                scrollRefObj.current[instanceId].anchorId = thisAnchorId;
                                            }

                                            if (thisScrollable) initNode();

                                            const updatePlacement = (ref) => {
                                                if (!ref || sheetNodeId.current === undefined) return;

                                                const id = findNodeHandle(ref);
                                                const thisObj = { ...avoidableSurfaces.current[instanceId] };
                                                avoidableSurfaces.current[instanceId] = thisObj;

                                                const copyOver = o => {
                                                    if (avoidableSurfaces.current[instanceId] === thisObj)
                                                        Object.entries(o)
                                                            .forEach(([k, v]) => {
                                                                thisObj[k] = v;
                                                            });
                                                }

                                                UIManager.measureLayout(
                                                    id,
                                                    sheetNodeId.current,
                                                    () => { },
                                                    (l, t, w, h) => {
                                                        copyOver({ l, t, w, h });
                                                    }
                                                );

                                                requestAnimationFrame(() => {
                                                    if (sheetNodeId.current !== undefined) {
                                                        UIManager.measure(
                                                            id,
                                                            (x, y, w, h, px, py) => {
                                                                copyOver({ w, h, px, py });
                                                                if (thisScrollable) scheduleAnchorUpdate();
                                                            }
                                                        );
                                                    }
                                                });
                                            }

                                            const newProps = {
                                                ...node?.props,
                                                __checking_snap_scrollable: true,
                                                ref: r => {
                                                    if (r) {
                                                        if (thisScrollable) {
                                                            initNode();
                                                            scrollRefObj.current[instanceId].ref = r;
                                                        }
                                                        updatePlacement(r);
                                                    }

                                                    const thatRef = node.props?.ref;
                                                    if (typeof thatRef === 'function') {
                                                        thatRef(r);
                                                    } else if (thatRef) thatRef.current = r;
                                                },
                                                onLayout: e => {
                                                    updatePlacement(e.currentTarget);
                                                    node.props?.onLayout?.(e);
                                                },
                                                ...thisScrollable ? {
                                                    ...disableDodging ? {} : { ['dodge_keyboard_scrollable']: true },
                                                    onScroll: e => {
                                                        onAnchorScroll(e, instanceId);
                                                        return node.props?.onScroll?.(e);
                                                    },
                                                    ...prefferedAnchor === instanceId ? { scrollEnabled } : {}
                                                } : {}
                                            };

                                            return cloneElement(node, newProps);
                                        }

                                        return createMutantElement(
                                            <SnapMutantNode onHandler={renderer} />
                                        );
                                    };

                                    return injectChild(node);
                                }}>
                                {children}
                            </MutateReact>
                            {isLift ?
                                <View
                                    ref={r => {
                                        if (r) {
                                            r[CheckFocusedNode] = true;
                                        }
                                    }}
                                    dodge_keyboard_input
                                    dodge_keyboard_clipping
                                    style={styling.fakePlaceholder}
                                /> : null}
                        </DodgeKeyboardComponent>
                    </View>
                </Animated.View>
            </View>
        </View>
    );
});

function SnapMutantNode({ onHandler }) {
    return onHandler();
}

const isScrollable = (element, disableTagCheck) => {
    if (
        element?.props?.['snap_sheet_scroll_anchor'] ||
        element?.props?.['snap_sheet_scrollable']
    ) return true;
    if (!element?.type || element?.props?.horizontal || disableTagCheck) return false;

    const scrollableTypes = ["ScrollView", "FlatList", "SectionList", "VirtualizedList"];

    return scrollableTypes.includes(element.type.displayName)
        || scrollableTypes.includes(element.type?.name);
};

/**
 * Find the child that is most visible and covers the largest area.
 *
 * @param {number} containerWidth
 * @param {number} containerHeight
 * @param {Array<{width: number, height: number, x: number, y: number}>} list
 * @returns {number}
 */
function getIndexOfMostVisibleArea(
    containerWidth,
    containerHeight,
    list
) {
    const containerArea = containerWidth * containerHeight;

    if (!list.length || containerArea <= 0) {
        return -1;
    }

    let bestIndex = -1;
    let bestScore = -1;
    let bestVisibleArea = -1;

    for (let i = 0; i < list.length; i++) {
        const { width, height, x, y } = list[i];

        const visibleWidth = Math.max(
            0,
            Math.min(containerWidth, x + width) - Math.max(0, x)
        );

        const visibleHeight = Math.max(
            0,
            Math.min(containerHeight, y + height) - Math.max(0, y)
        );

        const visibleArea = visibleWidth * visibleHeight;
        const totalArea = Math.max(0, width * height);

        const visibilityRatio =
            totalArea > 0 ? visibleArea / totalArea : 0;

        const containerCoverage = visibleArea / containerArea;

        const score =
            containerCoverage * 0.7 +
            visibilityRatio * 0.3;

        if (
            score > bestScore ||
            (score === bestScore && visibleArea > bestVisibleArea)
        ) {
            bestIndex = i;
            bestScore = score;
            bestVisibleArea = visibleArea;
        }
    }

    return bestIndex;
}

export default SnapSheet;
