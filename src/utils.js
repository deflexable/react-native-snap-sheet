
export const doRendable = (e, d) => e === undefined ? d : typeof e === 'function' ? e() : e;

export const isNumber = t => typeof t === 'number' && !isNaN(t) && Number.isFinite(t);