import { createContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { SnapSheetModalBase } from "./snapsheet_modal";

export const PortalContext = createContext();

export const SnapSheetProvider = ({ children }) => {
    const doUpdating = useRef();

    return (
        <PortalContext.Provider
            value={{
                updateModal: (...args) => doUpdating.current(...args)
            }}>
            <ModalShell doUpdating={doUpdating} />
            {children}
        </PortalContext.Provider>
    );
};

const ModalShell = ({ doUpdating }) => {
    const [portals, setPortals] = useReducer((prev, [key, shouldAdd]) => {
        if (shouldAdd) {
            if (prev.includes(key)) return prev;
            return [...prev, key];
        }
        return prev.filter(v => v !== key);
    }, []);

    const callerMap = useRef({});
    const hasMounted = useRef();
    const pendingEvent = useRef([]);

    useMemo(() => {
        doUpdating.current = (...args) => {
            if (hasMounted.current) {
                const [key, props, ref] = args;
                if (props) {
                    if (callerMap.current[key]?.doUpdate) {
                        callerMap.current[key].doUpdate({ props, ref });
                    } else {
                        const willMount = !!callerMap.current[key];

                        callerMap.current[key] = {
                            initState: { props, ref },
                            onMounted: () => {
                                callerMap.current[key].onMounted = undefined;
                                callerMap.current[key].initState = undefined;
                                if (willMount) callerMap.current[key].doUpdate({ props, ref });
                            }
                        };
                        if (!willMount) setPortals([key, true]);
                    }
                } else {
                    if (callerMap.current[key]) delete callerMap.current[key];
                    setPortals([key]);
                }
            } else pendingEvent.current.push(args);
        };
    }, []);

    useEffect(() => {
        hasMounted.current = true;
        pendingEvent.current.forEach(v => doUpdating.current(...v));
        pendingEvent.current = [];
    }, []);

    return portals.map(p =>
        <ModalShellItem
            key={p}
            caller={callerMap.current[p]} />
    );
}

const ModalShellItem = ({ caller }) => {
    const [state, setState] = useState(caller.initState);

    useEffect(() => {
        caller.doUpdate = setState;
        caller.onMounted();
    }, []);

    return <SnapSheetModalBase ref={state.ref} {...state.props} />;
}