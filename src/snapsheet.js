import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Animated, Keyboard, PanResponder, StyleSheet, useAnimatedValue, View } from "react-native";
import DodgeKeyboard, { ReactHijacker } from "react-native-dodge-keyboard";
import { doRendable, isNumber } from "./utils";
import { styling } from "./styling";

const PixelRate = 70 / 100; // 70ms to 100 pixels

const SnapSheet = forwardRef(function SnapSheet({
    snapPoints = [],
    initialSnapIndex = 0,
    minSnapIndex = 0,
    __loosenMinSnap,
    onSnapIndex,
    onSnapFinish,
    snapWhileDecelerating = false,
    style,
    inheritScrollVelocityOnExpand,
    inheritScrollVelocityOnCollapse,
    renderHandle,
    handleColor,
    keyboardDodgingBehaviour = 'optimum',
    keyboardDodgingOffset = 10,
    children,
    disabled,
    currentAnchorId,
    __shaky_sheet
}, ref) {
    const isLiftAlways = keyboardDodgingBehaviour === 'whole-always';
    const isLift = isLiftAlways || keyboardDodgingBehaviour === 'whole';
    const isOptimum = keyboardDodgingBehaviour === 'optimum';

    if (!['optimum', 'whole', 'whole-always', 'off'].includes(keyboardDodgingBehaviour))
        throw `keyboardDodgingBehaviour must be any of ${['optimum', 'whole', 'whole-always', 'off']} but got ${keyboardDodgingBehaviour}`;

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

    const initSnapPoints = snapPoints;

    const [scrollEnabled, setScrollEnabled] = useState(false);
    const [dodgeOffset, setDodgeOffset] = useState(0);
    const [requiredLift, setRequiredLift] = useState(0);
    const [currentIndex, setCurrentIndex] = useState(initialSnapIndex);
    const [finishedIndex, setFinishedIndex] = useState(initialSnapIndex);
    const [prefferedAnchor, setPrefferedAnchor] = useState();

    const extraLift = (dodgeOffset || isLiftAlways) &&
        ((isOptimum ? dodgeOffset : isLift ? requiredLift : 0) || 0);

    snapPoints = snapPoints.map(v => v + extraLift);
    const snapPointsKey = `${snapPoints}`;
    // console.log('sheetLifing:', { extraLift, dodgeOffset, requiredLift, initSnapPoints: `${initSnapPoints}`, snapPoints: `${snapPoints}` });
    const MAX_HEIGHT = snapPoints.slice(-1)[0];
    const MODAL_HEIGHT = snapPoints.slice(-1)[0] - snapPoints[0];

    const snapTranslateValues = useMemo(() => snapPoints.map(h => MAX_HEIGHT - h), [snapPointsKey]);

    const translateY = useAnimatedValue(snapTranslateValues[initialSnapIndex]);

    /**
     * @type {import("react").RefObject<{[key: string]: { ref: import('react-native').ScrollView, scrollY: 0, location: number[], anchorId: boolean }}>}
     */
    const scrollRefObj = useRef({});
    const lastOffset = useRef(translateY._value);
    const lastSnapIndex = useRef(initialSnapIndex);
    const bottomFakePlaceholderRef = useRef();
    const instantPrefferAnchor = useRef();
    instantPrefferAnchor.current = prefferedAnchor;

    const prevScrollY = useRef(0);
    const prevTime = useRef(0);

    const instantScrollEnabled = useRef(scrollEnabled);
    instantScrollEnabled.current = scrollEnabled;

    const updateKeyboardOffset = () => {
        if (!isLift) {
            setRequiredLift(0);
            return;
        }
        const keyboardInfo = Keyboard.metrics();
        if (keyboardInfo?.height && keyboardInfo.screenY) {
            bottomFakePlaceholderRef.current.measureInWindow((x, y) => {
                const remains = y - keyboardInfo.screenY;
                setRequiredLift(Math.max(0, remains));
            });
        } else setRequiredLift(0);
    }

    useEffect(updateKeyboardOffset, [dodgeOffset, `${initSnapPoints}`]);

    useEffect(() => {
        if (!isLiftAlways) return;

        const frameListener = Keyboard.addListener('keyboardDidChangeFrame', updateKeyboardOffset);
        const showListener = Keyboard.addListener('keyboardDidShow', updateKeyboardOffset);
        const hiddenListener = Keyboard.addListener('keyboardDidHide', updateKeyboardOffset);

        return () => {
            frameListener.remove();
            showListener.remove();
            hiddenListener.remove();
        }
    }, [isLiftAlways]);

    const getCurrentSnap = (draggingUpward) => {
        const shownHeight = MODAL_HEIGHT - translateY._value;
        const currentSnapIndex = draggingUpward ? snapPoints.findIndex((v, i, a) => v <= shownHeight && (i === a.length - 1 || shownHeight < a[i + 1]))
            : snapPoints.findIndex((v, i, a) => v >= shownHeight && (!i || shownHeight > a[i - 1]));

        return currentSnapIndex;
    }

    const snapToIndex = useRef();

    snapToIndex.current = (index, force, velocity, onFinish) => {
        if (disabled && !force) return;

        if (!Number.isInteger(index) || index < 0 || index > snapPoints.length - 1)
            throw new Error(`invalid snap index:${index}, index must be within range 0 - ${snapPoints.length - 1}`);

        if (index < minSnapIndex) index = minSnapIndex;

        const newY = snapTranslateValues[index];

        if (__shaky_sheet && lastOffset.current !== newY)
            translateY.setValue(lastOffset.current);

        const prevY = translateY._value;
        setScrollEnabled(index === snapPoints.length - 1);
        setCurrentIndex(index);

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

        // console.log('snapTimer:', { timeout, pixel });

        Animated.spring(translateY, {
            velocity,
            toValue: newY,
            useNativeDriver: true
        }).start(() => {
            clearTimeout(timer);
            setFinishedIndex(index);
            guessFinish();
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
        snapToIndex.current(Math.min(lastSnapIndex.current, snapPoints.length - 1), true);
    }, [snapPointsKey]);

    const panResponder = useMemo(() => {

        return PanResponder.create({
            onMoveShouldSetPanResponderCapture: (_, gesture) => {
                const { scrollY } = scrollRefObj.current[instantPrefferAnchor.current] || {};

                const isMovingY = (minChange = 3) =>
                    gesture.dy > minChange &&
                    (gesture.dy / (gesture.dy + gesture.dx)) >= .75;

                const shouldCapture = !disabled && (
                    !instantScrollEnabled.current ||
                    (scrollY <= 0 && isMovingY(5)) ||
                    (instantPrefferAnchor.current === undefined && isMovingY(10))
                );
                if (shouldCapture) setScrollEnabled(false);
                // console.log('onMoveShouldSetPanResponderCapture shouldCapture:', shouldCapture, ' stats:', { gesture, scrollOffset: scrollY, instantScrollEnabled: instantScrollEnabled.current }, ' gesture.dy > 0:', gesture.dy > 1);
                return shouldCapture;
            },
            onPanResponderMove: (_, gesture) => {
                const newY = gesture.dy + lastOffset.current;

                if (newY < snapPoints[__loosenMinSnap ? 0 : minSnapIndex] || newY > MODAL_HEIGHT) return;

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
    }, [!disabled, snapPointsKey, minSnapIndex]);

    const conStyle = useMemo(() => ({
        position: "absolute",
        width: "100%",
        backgroundColor: "#fff",
        borderTopLeftRadius: 25,
        borderTopRightRadius: 25,
        zIndex: 1,
        ...StyleSheet.flatten(style),
        bottom: snapPoints[0],
        height: MODAL_HEIGHT,
        transform: [{ translateY }]
    }), [snapPointsKey, style]);

    const updateAnchorReducer = useRef();

    const scheduleAnchorUpdate = (timeout = 100) => {
        clearTimeout(updateAnchorReducer.current);
        updateAnchorReducer.current = setTimeout(updatePrefferAnchor, timeout);
    }

    const updatePrefferAnchor = () => {
        const rankedAnchors = Object.entries(scrollRefObj.current).sort((a, b) => compareReactPaths(a[1].location, b[1].location));
        const directAnchor = rankedAnchors.find(v => v[1].anchorId === currentAnchorId);
        setPrefferedAnchor(directAnchor?.[0]);
    }
    useEffect(updatePrefferAnchor, [currentAnchorId]);

    const onAnchorScroll = (e, instanceId) => {
        const scrollY = e.nativeEvent.contentOffset.y;
        if (scrollRefObj.current[instanceId])
            scrollRefObj.current[instanceId].scrollY = scrollY;

        // console.log('onAnchorScroll scrollOffset:', scrollY);
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

    const handleDotStyle = useMemo(() => ({
        ...styling.modalHandleItem,
        ...handleColor ? { backgroundColor: handleColor } : {}
    }), [handleColor]);

    const disableDodging = keyboardDodgingBehaviour === 'off';
    const sameIndex = currentIndex === finishedIndex;

    return (
        <View style={styling.absoluteFill}>
            <Animated.View
                style={conStyle}
                {...panResponder.panHandlers}>
                {doRendable?.(
                    renderHandle,
                    <View style={styling.modalHandle}>
                        <View style={handleDotStyle} />
                    </View>
                )}
                <View style={styling.flexer}>
                    <DodgeKeyboard
                        offset={keyboardDodgingOffset}
                        disabled={!sameIndex || disableDodging}
                        onHandleDodging={({ liftUp }) => {
                            setDodgeOffset(liftUp);
                        }}>
                        {ReactHijacker({
                            children,
                            doHijack: (node, path) => {
                                if (node?.props?.['snap_sheet_scan_off']) return { element: node };

                                if (isScrollable(node)) {
                                    const instanceId = path.join(',');

                                    const initNode = () => {
                                        if (!scrollRefObj.current[instanceId])
                                            scrollRefObj.current[instanceId] = { scrollY: 0, location: path };
                                        const thisAnchorId = node.props?.snap_sheet_scroll_anchor;

                                        if (scrollRefObj.current[instanceId].anchorId !== thisAnchorId) {
                                            scheduleAnchorUpdate(300);
                                        }
                                        scrollRefObj.current[instanceId].anchorId = thisAnchorId;
                                    }
                                    initNode();

                                    return {
                                        props: {
                                            ...node?.props,
                                            ...disableDodging ? {} : { ['dodge_keyboard_scrollable']: true },
                                            ref: r => {
                                                if (r) {
                                                    initNode();
                                                    // if (scrollRefObj.current[instanceId].ref !== r) scheduleAnchorUpdate();
                                                    scrollRefObj.current[instanceId].ref = r;
                                                } else if (scrollRefObj.current[instanceId]) {
                                                    delete scrollRefObj.current[instanceId];
                                                    scheduleAnchorUpdate();
                                                }

                                                const thatRef = node.props?.ref;
                                                if (typeof thatRef === 'function') {
                                                    thatRef(r);
                                                } else if (thatRef) thatRef.current = r;
                                            },
                                            ...prefferedAnchor === instanceId ? { scrollEnabled } : {},
                                            onScroll: (e) => {
                                                onAnchorScroll(e, instanceId);
                                                return node.props?.onScroll?.(e);
                                            }
                                        }
                                    }
                                }
                            }
                        })}
                    </DodgeKeyboard>
                </View>
            </Animated.View>
            {isLift ?
                <View
                    ref={bottomFakePlaceholderRef}
                    style={styling.fakePlaceholder}
                    onLayout={updateKeyboardOffset} /> : null}
        </View>
    );
});

const isScrollable = (element, disableTagCheck) => {
    if (element?.props?.['snap_sheet_scroll_anchor']) return true;
    if (!element?.type || element?.props?.horizontal || disableTagCheck) return false;

    const scrollableTypes = ["ScrollView", "FlatList", "SectionList", "VirtualizedList"];

    return scrollableTypes.includes(element.type.displayName)
        || scrollableTypes.includes(element.type?.name);
};

function extractPath(entry) {
    return entry.filter(v => typeof v === 'number');
}

// lexicographic comparison of two paths
function compareReactPaths(a, b) {
    const pa = extractPath(a);
    const pb = extractPath(b);

    const len = Math.max(pa.length, pb.length);

    for (let i = 0; i < len; i++) {
        const av = pa[i];
        const bv = pb[i];

        if (av === undefined) return -1;  // a ends early -> comes first
        if (bv === undefined) return 1;   // b ends early -> comes first

        if (av !== bv) return av - bv;    // normal numeric comparison
    }
    return 0;
}

export default SnapSheet;
