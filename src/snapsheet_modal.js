import { forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState, cloneElement } from "react";
import { Pressable, StyleSheet, View, PixelRatio } from "react-native";
import { createHijackedElement, isDodgeInput, ReactHijacker, __HijackNode } from "react-native-dodge-keyboard";
import { useBackButton } from "react-native-push-back";
import { doRendable, isNumber } from "./utils";
import { PortalContext } from "./provider";
import { styling } from "./styling";
import SnapSheet from "./snapsheet";

const ModalState = ['closed', 'middle', 'opened'];
const CenteredSheetStyle = { width: 0, height: 0 };
const CheckFocusedNode = '__fakeSnapSheetModalFocused';

export const SnapSheetModalBase = forwardRef(function SnapSheetModalBase({
    onOpened,
    onClosed,
    modalHeight,
    middleHeight,
    initialState = 'closed',
    centered,
    onStateChanged,
    renderBackDrop,
    disableBackdrop,
    fillScreen = true,
    unMountChildrenWhenClosed = true,
    disableBackHandler,
    containerStyle,
    disabled,
    disablePanGesture,
    children,
    ...restProps
}, ref) {
    const isLift = restProps?.keyboardDodgingBehaviour === 'whole';

    centered = !!centered;
    useMemo(() => {
        if (centered) {
            if (modalHeight) console.warn('modalHeight is not needed if centered={true}');
            if (middleHeight) console.warn('middleHeight is not needed if centered={true}');
        }
    }, [centered]);

    if (restProps.__checkIfElementIsFocused !== undefined && typeof restProps.__checkIfElementIsFocused !== 'function')
        throw `expected '__checkIfElementIsFocused' to be a function but got ${restProps.__checkIfElementIsFocused}`;

    if (centered) {
        middleHeight = undefined;
        if (initialState === 'middle') initialState = 'opened';
    }

    const initialSnapIndex = ModalState.indexOf(initialState);
    if (initialSnapIndex === -1)
        throw `initialState must be any of ${initialState} but got ${initialState}`;
    const hasMiddle = isNumber(middleHeight);

    if (!hasMiddle && initialState === 'middle')
        throw `middleHeight is required if initialState is "middle"`;

    const [futureState, setFutureState] = useState(initialState);
    const [currentState, setCurrentState] = useState(initialState);
    const [autoIndexModal, setAutoIndexModal] = useState(initialSnapIndex);
    const [viewDim, setViewDim] = useReducer((prev, incoming) => {
        if (!incoming.some((v, i) => prev[i] !== v)) return prev;
        return incoming;
    }, [undefined, undefined]);
    const [contentHeight, setContentHeight] = useState();
    const [releaseUnmount, setReleaseUnmount] = useState();
    const [viewWidth, viewHeight] = viewDim;

    const sizingReadyCaller = useRef({ promise: undefined, callback: undefined });
    const makeSizingPromise = () => {
        if (centered)
            sizingReadyCaller.current.promise = new Promise(resolve => {
                sizingReadyCaller.current.callback = resolve;
            });
    }

    useMemo(makeSizingPromise, []);

    const sizingReady = !centered || (contentHeight !== undefined && viewHeight !== undefined);
    const hasClosed = futureState === 'closed' && currentState === 'closed';

    useEffect(() => {
        if (sizingReady) {
            sizingReadyCaller.current.callback?.();
            sizingReadyCaller.current.callback = undefined;
        } else if (!sizingReadyCaller.current.callback) {
            makeSizingPromise();
        }
    }, [sizingReady]);

    const unmountChild = !!(hasClosed && unMountChildrenWhenClosed);
    useEffect(() => {
        if (unmountChild && centered) setContentHeight();
    }, [unmountChild, !centered]);

    const snapPoints = useMemo(() => {
        if (centered) {
            if (sizingReady)
                return [0, (viewHeight / 2) + (contentHeight / 2)];
            return [0, .3];
        } else return [0, ...isNumber(middleHeight) ? [middleHeight] : [], modalHeight];
    }, [viewHeight, contentHeight, centered, middleHeight, modalHeight]);

    const willClose = futureState === 'closed';
    const isOpened = futureState !== 'closed';

    const sheetRef = useRef();
    const inputRefs = useRef({});
    const snapModal = useRef();
    const lastIndexIntent = useRef({});

    snapModal.current = async (index, force) => {
        if (disabled && !force) return;

        if (sizingReadyCaller.current.callback) {
            if (index && unMountChildrenWhenClosed && !releaseUnmount)
                setReleaseUnmount(true);
            const intent =
                lastIndexIntent.current[index] === undefined
                    ? (lastIndexIntent.current[index] = 0)
                    : ++lastIndexIntent.current[index];

            await sizingReadyCaller.current.promise;
            if (lastIndexIntent.current[index] !== intent) return;
        }

        if (index && !sheetRef.current && !autoIndexModal) {
            setAutoIndexModal(index);
        } else if (sheetRef.current) {
            sheetRef.current.snap(index);
        }
    }

    useImperativeHandle(ref, () => ({
        open: () => snapModal.current(hasMiddle ? 2 : 1, true),
        close: () => snapModal.current(0, true),
        middleSnap: () => {
            if (!hasMiddle) throw 'calling middleSnap() requires middleHeight to be defined in the ref component';
            snapModal.current(1, true);
        }
    }));

    const hasMountAutoIndex = useRef();
    useEffect(() => {
        if (hasMountAutoIndex.current) {
            if (autoIndexModal) snapModal.current(autoIndexModal, true);
        }
        hasMountAutoIndex.current = true;
    }, [!autoIndexModal]);

    useEffect(() => {
        if (willClose)
            try {
                Object.values(inputRefs.current).forEach(e => {
                    if (e?.isFocused?.()) e?.blur?.();
                });
            } catch (error) {
                console.error('snapSheet remove auto-blur err', error);
            }
    }, [willClose]);

    const hasMountState = useRef();
    useEffect(() => {
        if (futureState !== currentState) return;
        if (hasMountState.current) {
            onStateChanged?.(futureState);
        }
        hasMountState.current = true;
    }, [futureState, currentState]);

    const hasMountOpened = useRef();
    useEffect(() => {
        if (futureState !== currentState) return;
        if (hasClosed) setAutoIndexModal(0);
        if (hasMountOpened.current)
            if (hasClosed) {
                setReleaseUnmount();
                onClosed?.();
            } else onOpened?.();
        hasMountOpened.current = true;
    }, [futureState, currentState]);

    useBackButton(() => {
        snapModal.current(0);
    }, disableBackHandler || !isOpened);

    const centeredStyle = useMemo(() => centered ? ({
        position: 'absolute',
        width: viewWidth,
        left: 0,
        top: 0
    }) : undefined, [centered, contentHeight, viewWidth]);

    const inputIdIterator = useRef(0);

    const renderChild = () =>
        <View
            style={styling.absoluteFill}
            onLayout={e => {
                const { width, height } = e.nativeEvent.layout;
                setViewDim([width, height]);
            }}>
            {hasClosed ? null :
                doRendable(
                    renderBackDrop,
                    <Pressable
                        style={styling.backdropStyle}
                        disabled={!!disableBackdrop}
                        onPress={() => {
                            snapModal.current(0);
                        }} />
                )}
            <ReactHijacker
                doHijack={node => {
                    // if (node?.props?.dodge_keyboard_scan_off)
                    //     return createHijackedElement(node);
                    if (!isDodgeInput(node)) return;

                    const renderer = () => {
                        const inputId = useMemo(() => `${++inputIdIterator.current}`, []);

                        const newProps = {
                            ...node.props,
                            ref: r => {
                                if (r) {
                                    inputRefs.current[inputId] = r;
                                } else if (inputRefs.current[inputId]) {
                                    delete inputRefs.current[inputId];
                                }

                                const thatRef = node.props?.ref;
                                if (typeof thatRef === 'function') {
                                    thatRef(r);
                                } else if (thatRef) thatRef.current = r;
                            }
                        };

                        return cloneElement(node, newProps);
                    }

                    return createHijackedElement(
                        <__HijackNode>
                            {renderer}
                        </__HijackNode>
                    );
                }}>
                <SnapSheet
                    {...restProps}
                    minSnapIndex={0}
                    ref={sheetRef}
                    snapPoints={snapPoints}
                    {...centered ? {
                        style: CenteredSheetStyle,
                        renderHandle: null,
                        ...isLift ? {
                            __checkIfElementIsFocused: (r, refs) => {
                                const realChecker = restProps?.__checkIfElementIsFocused;
                                return !!r?.[CheckFocusedNode] &&
                                    !willClose &&
                                    refs.some(v => realChecker ? realChecker?.(v, refs) : v?.isFocused?.());
                            },
                            keyboardDodgingBehaviour: 'optimum'
                        } : {}
                    } : {}}
                    {...hasClosed ? { keyboardDodgingBehaviour: 'off' } : {}}
                    initialSnapIndex={Math.min(ModalState.indexOf(currentState), centered ? 1 : 2)}
                    disabled={centered || disabled || disablePanGesture}
                    onSnapFinish={i => {
                        setCurrentState(ModalState[i]);
                    }}
                    onSnapIndex={i => {
                        setFutureState(ModalState[i]);
                    }}>
                    {(hasClosed && (!releaseUnmount && unMountChildrenWhenClosed))
                        ? null :
                        <View
                            style={centered ? centeredStyle : styling.flexer}
                            onLayout={e => {
                                if (centered) {
                                    const h = e.nativeEvent.layout.height;

                                    if (contentHeight === undefined)
                                        return setContentHeight(PixelRatio.roundToNearestPixel(h));

                                    const pixel = PixelRatio.roundToNearestPixel(h);

                                    if (Math.abs(contentHeight - pixel) >= 1)
                                        setContentHeight(pixel);
                                }
                            }}>
                            <View style={centered ? restProps.style : styling.flexer}>
                                {children}
                            </View>
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
                        </View>}
                </SnapSheet>
            </ReactHijacker>
        </View>

    const conStyle = useMemo(() => {
        const flatStyle = StyleSheet.flatten(containerStyle);

        return {
            zIndex: hasClosed ? -99 : 9999,
            elevation: hasClosed ? 0 : 9999,
            ...hasClosed ? { opacity: 0 } : {},
            ...flatStyle,
            position: 'absolute',
            width: '100%',
            height: '100%',
            top: 0,
            left: 0
        };
    }, [containerStyle, hasClosed]);

    return (
        <View style={conStyle}
            pointerEvents={willClose ? 'none' : 'auto'}>
            {renderChild()}
        </View>
    );
});

let mountIdIterator = 0;

export const SnapSheetModal = forwardRef(function SnapSheetModal({
    fillScreen,
    ...props
}, ref) {
    const { updateModal } = useContext(PortalContext) || {};

    const mountID = useMemo(() => ++mountIdIterator, []);

    useEffect(() => {
        if (fillScreen) updateModal(mountID, props, ref);
    });

    useEffect(() => {
        if (fillScreen)
            return () => {
                updateModal(mountID);
            }
    }, [!fillScreen]);

    if (fillScreen) return null;
    return <SnapSheetModalBase ref={ref} {...props} />;
});