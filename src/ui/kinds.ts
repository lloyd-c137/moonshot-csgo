// Room-kind colours for the location plate stripe (stronger versions of the minimap fills) and fallback labels.
export const KIND_STRIPE: Record<string, string> = {
    classroom: '#5b8fd6',
    office: '#8a97a8',
    meeting: '#6fb36b',
    service: '#7d8590',
    hall: '#d98b52',
    lab: '#3fae9f',
    creative: '#b07cd1',
    dining: '#e2b23e',
    library: '#6f7fe0',
    room: '#9aa5b1',
    restroom: '#5fb2cf',
    garden: '#7fbf4d',
    stair: '#a0a4ab',
    public: '#d6c08c'
};

export const KIND_FALLBACK_LABEL: Record<string, string> = {
    hall: '大厅与场馆',
    garden: '室外庭院'
};
