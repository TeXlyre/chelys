// src/webrtc-polyfill/webrtc-adapter-shim.ts
interface BrowserDetails {
    browser: string;
    version: number;
}

interface Adapter {
    browserDetails: BrowserDetails;
    extractVersion: (uastring: string, expr: string | RegExp, pos: number) => number | null;
    disableLog: (bool: boolean) => void;
    disableWarnings: (bool: boolean) => void;
}

const adapter: Adapter = {
    browserDetails: { browser: "chrome", version: 120 },
    extractVersion: () => null,
    disableLog: () => { },
    disableWarnings: () => { },
};

export default adapter;