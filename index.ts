import * as React from "react";
import { StyleProp, ViewStyle } from "react-native";

export interface SnapSheetBaseProps {
    /**
     * Child content inside the snap sheet
     */
    children?: React.ReactNode;

    /**
     * Called when snapping begins or index changes
     */
    onSnapIndex?: (index: number) => void;

    /**
     * Called when snapping animation fully finishes
     */
    onSnapFinish?: (index: number) => void;

    /**
     * If enabled, the sheet will snap to the nearest previous snap point
     * (instead of jumping directly to index 0) while the gesture is decelerating.
     * 
     * @default false
     */
    snapWhileDecelerating?: boolean;

    /**
     * Style applied to the sheet
     */
    style?: StyleProp<ViewStyle>;

    /**
     * Whether the sheet should transfer its remaining downward drag velocity to a child scroll view when expanding.
     * 
     * @default false
     */
    inheritScrollVelocityOnExpand?: boolean;

    /**
     * Whether the sheet should inherit the remaining upward scroll velocity from a child scroll view when collapsing.
     * 
     * @default false
     */
    inheritScrollVelocityOnCollapse?: boolean;

    /**
     * Function to render the sheet handle (top drag indicator)
     * 
     * this is not used if `centered` is true
     */
    renderHandle?: React.ReactNode | (() => React.ReactNode);

    /**
     * Color of the sheet handle
     */
    handleColor?: string | undefined;

    /**
     * Behaviour for avoiding keyboard overlap
     * - "off" → disables keyboard dodging
     * - "optimum" → intelligently lift only needed amount
     * - "whole" → move entire sheet above keyboard
     * 
     * `react-native-dodge-keyboard` is used for keyboard dodging and automatic tag detection for scrollable and input components.
     *
     * By default, the known scrollable tags are:
     *  - "ScrollView"
     *  - "FlatList"
     *  - "SectionList"
     *  - "VirtualizedList"
     *
     * If you want a custom scrollable element to support dodging,
     * add the prop: `dodge_keyboard_scrollable={true}`.
     *
     * By default, "TextInput" is the only known input tag.
     * To enable dodging for a custom input element,
     * add the prop: `dodge_keyboard_input={true}`.
     * 
     * Input elements or views with dodge_keyboard_input={true} that are not inside a scrollable view must be manually lifted by responding to the `onHandleDodging` callback.
     * 
     * @default 'optimum'
     */
    keyboardDodgingBehaviour?: "off" | "optimum" | "whole";

    /**
     * Additional offset to add when dodging keyboard
     * 
     * @default 10
     */
    keyboardDodgingOffset?: number;
}

export interface SnapSheetProps extends SnapSheetBaseProps {
    /**
     * List of snap point heights (e.g. [0, 300, 600])
     */
    snapPoints?: number[];

    /**
     * The snap index to start from on initial mount
     * 
     * @default 0
     */
    initialSnapIndex?: number;

    /**
     * Disable user interactions on the snap sheet
     * 
     * @default false
     */
    disabled?: boolean;
}

export interface SnapSheetRef {
    /**
     * snap to an index
     * @param index index to snap to
     */
    snap(index: number): void;
}

export declare const SnapSheet: React.ForwardRefExoticComponent<
    React.PropsWithoutRef<SnapSheetProps> &
    React.RefAttributes<SnapSheetRef | undefined>
>;


// <------- SnapSheetModal ------>

export type SnapSheetModalState = "closed" | "middle" | "opened";

export interface SnapSheetModalProps extends SnapSheetBaseProps {
    /**
     * Called when the sheet fully opens
     */
    onOpened?: () => void;

    /**
     * Called when the sheet fully closes
     */
    onClosed?: () => void;

    /**
     * Height when fully opened
     * 
     * this is not needed if `centered` is true
     */
    modalHeight: number;

    /**
     * Height of "middle" snap point
     * 
     * this is not used if `centered` is true
     */
    middleHeight: number;

    /**
     * Initial state of the modal
     * 
     * @default 'closed'
     */
    initialState?: SnapSheetModalState;

    /**
     * Called when the sheet transitions to a new state
     */
    onStateChanged?: (state: SnapSheetModalState) => void;

    /**
     * Optional backdrop renderer (e.g. dim overlay)
     */
    renderBackDrop?: React.ReactNode | (() => React.ReactNode);

    /**
     * Disable backdrop press
     * 
     * @default false
     */
    disableBackdrop?: boolean;

    /**
     * If true, modal can cover the whole screen area.
     * 
     * setting this to `true` requires you to add `<SafeAreaProvider>` at the top of your App.js file
     * 
     * @default false
     */
    fillScreen?: boolean;

    /**
     * When true, the children are unmounted when sheet is closed
     * 
     * @default true
     */
    unMountChildrenWhenClosed?: boolean;

    /**
     * Style applied to the modal container (not the snap sheet)
     */
    containerStyle?: StyleProp<ViewStyle>;

    /**
     * Enable back button press handler when the modal is opened
     * 
     * @default false
     */
    disableBackHandler?: boolean;

    /**
     * Disable user interactions on the snap sheet including indirect actions such as backdrop press and back button press.
     * 
     * You can still control snap sheet programmatically via `ref.open()`, `ref.close()` or `ref.middleSnap()`
     * 
     * @default false
     */
    disabled?: boolean;

    /**
     * Disable pan gesture on the snap sheet while still retaining indirect actions such as backdrop press and back button press.
     * 
     * @default false
     */
    disablePanGesture?: boolean;

    /**
     * True to render children content at the center of the modal instead of the bottom
     * 
     * @default false
     */
    centered?: boolean;
}

export interface SnapSheetModalRef {
    /**
     * fully open the modal
     */
    open(): void;

    /**
     * close the modal
     */
    close(): void;

    /**
     * partially open the modal and snap to `middleHeight`
     */
    middleSnap(): void;
}

export declare const SnapSheetModal: React.ForwardRefExoticComponent<
    React.PropsWithoutRef<SnapSheetModalProps> &
    React.RefAttributes<SnapSheetModalRef | undefined>
>;

export declare const SnapSheetProvider: React.Component;