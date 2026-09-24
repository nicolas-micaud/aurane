import type { Command, Faction, Persona } from '@aurane/protocol';
import type { ApplyResult, PlayerView } from '@aurane/sim';
export declare const view: import("@preact/signals-core").Signal<PlayerView | null>;
export declare const status: import("@preact/signals-core").Signal<"idle" | "connecting" | "online" | "offline">;
export declare const toast: import("@preact/signals-core").Signal<{
    text: string;
    kind: "ok" | "err";
} | null>;
export declare const getToken: () => string | null;
export declare const forget: () => void;
export declare function createGuest(name: string, faction: Faction, persona: Persona): Promise<void>;
export declare function connect(): void;
export declare function send(command: Command): Promise<ApplyResult>;
export declare function act(command: Command, okText?: string): Promise<boolean>;
//# sourceMappingURL=net.d.ts.map