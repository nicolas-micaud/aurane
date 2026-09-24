import { Application } from 'pixi.js';
import { type PlayerView } from '@aurane/sim';
export declare const FACTION_COLOR: Record<string, number>;
export declare const RESOURCE_COLOR: Record<string, number>;
export interface MapCallbacks {
    onSelect(systemId: string | null): void;
}
export declare class GalaxyMap {
    private readonly cb;
    readonly app: Application<import("pixi.js").Renderer>;
    private world;
    private fogLayer;
    private sectorLayer;
    private relayLayer;
    private systemLayer;
    private fleetLayer;
    private labelLayer;
    private view;
    private selected;
    private linkFrom;
    private factionOf;
    private systemById;
    private ready;
    private pointers;
    private pinchDist;
    private dragMoved;
    constructor(cb: MapCallbacks);
    mount(el: HTMLElement): Promise<void>;
    destroy(): void;
    setSelection(id: string | null): void;
    setLinkFrom(id: string | null): void;
    centerOn(systemId: string): void;
    update(view: PlayerView): void;
    private render;
    private drawFog;
    private drawSectors;
    private drawRelays;
    private drawSystems;
    private drawFleets;
    private bindCamera;
    private zoomAt;
}
//# sourceMappingURL=GalaxyMap.d.ts.map