import type {
  Building,
  BuildingType,
  InteractionModeType,
  InteractionMode,
  PlacementGhost,
  TilePoint,
  PresentationPreferences,
} from '../types.ts';
import { observePresentation } from './domain-feedback.ts';
import type { GameRuntime } from '../runtime.ts';
import type { GuardPostPreview, PlacementPreview, RoadPreview } from '../gameplay/previews.ts';
export function createInteraction(game: InteractionDependencies): InteractionSubsystem {
  const ORDER = [
    'lumberjack',
    'forester',
    'sawmill',
    'quarry',
    'fisherman',
    'farm',
    'windmill',
    'bakery',
    'pigfarm',
    'butcher',
    'well',
    'brewery',
    'mine_coal',
    'mine_iron',
    'mine_gold',
    'smelter',
    'workshop',
    'toolsmith',
    'armory',
    'warehouse',
    'guard',
    'road',
    'demolish',
  ];
  let selected: Building | null = null,
    mode: InteractionMode | null = null,
    anchor: TilePoint | null = null,
    ghost: PlacementGhost | null = null,
    selInfo: TilePoint | null = null,
    demoArm: Building | null = null,
    flagIdx = 0,
    hovT = 0,
    hovX = 0,
    hovY = 0,
    ttStr: string | null = null;

  const presentationPrefs: PresentationPreferences = {
    showFps: true,
    atlasExpanded: false,
    minimapVisible: true,
    reducedMotion: false,
    weather: true,
    clarity: false,
    quality: 1,
    overlay: 'none',
  };
  // The active tool's preview at the hovered site; the domain caches each answer.
  function placementPreview(): PlacementPreview | null {
    if (!mode || mode.type !== 'build' || !ghost || !ghost.in) return null;
    return game.previewPlacement(mode.bt, ghost);
  }
  function roadPreview(): RoadPreview | null {
    if (
      !mode ||
      mode.type !== 'road' ||
      !anchor ||
      !game.hoverIn ||
      !game.inB(game.ht.x, game.ht.y)
    )
      return null;
    return game.previewRoad(anchor, game.ht);
  }
  function guardPreview(): GuardPostPreview | null {
    if (!mode || mode.type !== 'build' || mode.bt !== 'guard' || !ghost || !ghost.in || !ghost.ok)
      return null;
    return game.previewGuardPost(ghost);
  }
  function refreshTool() {
    game.refreshToolView();
  }
  function setMode(mtype: InteractionModeType | null, bt?: BuildingType | null) {
    mode = mtype ? ({ type: mtype, bt: bt || null } as InteractionMode) : null;
    anchor = null;
    selInfo = null;
    demoArm = null;
    refreshTool();
  }
  function dismissInspector() {
    selected = null;
    selInfo = null;
    game.clearRemovedContributor();
    game.updateInfo();
  }
  function cancelMode() {
    // Reset every world reference before asking presentation to refresh.
    selected = null;
    setMode(null);
    game.updateInfo();
  }
  function roadInput(tile: TilePoint, shift = false) {
    if (!anchor) anchor = { x: tile.x, y: tile.y };
    else if (shift) {
      if (game.commitRoad(anchor, tile)) anchor = { x: tile.x, y: tile.y };
    } else {
      game.commitRoad(anchor, tile);
      anchor = null;
    }
  }
  function demolitionInput(target: Building | null, shift = false): DemolitionAction {
    if (!target) {
      demoArm = null;
      return 'missing';
    }
    if (!shift && game.requestDemolitionConfirmation) {
      demoArm = target;
      game.requestDemolitionConfirmation(target);
      return 'armed';
    }
    if (shift || demoArm === target) {
      game.demolish(target);
      demoArm = null;
      return 'confirmed';
    }
    demoArm = target;
    return 'armed';
  }
  function activateTool(mtype: InteractionModeType, bt?: BuildingType | null) {
    setMode(mtype, bt);
    dismissInspector();
  }
  function selectMapTarget(building: Building | null, tile: TilePoint) {
    selected = building;
    selInfo = building ? null : { x: tile.x, y: tile.y };
    game.updateInfo();
  }
  function inspectBuilding(building: Building | null, source: InspectionSource) {
    if (source === 'journey') setMode(null);
    selected = building;
    if (source !== 'advisor') selInfo = null;
    if (source !== 'advisor' || building) game.updateInfo();
  }
  observePresentation(game, 'worldLoaded', cancelMode);
  observePresentation(game, 'buildingDemolished', (event) => {
    if (selected?.id === event.id) {
      dismissInspector();
      game.showRemovedContributor(event);
    }
  });
  return {
    activateTool,
    selectMapTarget,
    inspectBuilding,
    demolitionInput,
    roadInput,
    setMode,
    cancelMode,
    dismissInspector,
    placementPreview,
    roadPreview,
    guardPreview,
    get ORDER() {
      return ORDER;
    },
    presentationPrefs,
    get selected() {
      return selected;
    },
    set selected(value: typeof selected) {
      selected = value;
    },
    get mode() {
      return mode;
    },
    set mode(value: typeof mode) {
      mode = value;
    },
    get anchor() {
      return anchor;
    },
    set anchor(value: typeof anchor) {
      anchor = value;
    },
    get ghost() {
      return ghost;
    },
    set ghost(value: typeof ghost) {
      ghost = value;
    },
    get selInfo() {
      return selInfo;
    },
    set selInfo(value: typeof selInfo) {
      selInfo = value;
    },
    get demoArm() {
      return demoArm;
    },
    set demoArm(value: typeof demoArm) {
      demoArm = value;
    },
    get flagIdx() {
      return flagIdx;
    },
    set flagIdx(value: typeof flagIdx) {
      flagIdx = value;
    },
    get hovT() {
      return hovT;
    },
    set hovT(value: typeof hovT) {
      hovT = value;
    },
    get hovX() {
      return hovX;
    },
    set hovX(value: typeof hovX) {
      hovX = value;
    },
    get hovY() {
      return hovY;
    },
    set hovY(value: typeof hovY) {
      hovY = value;
    },
    get ttStr() {
      return ttStr;
    },
    set ttStr(value: typeof ttStr) {
      ttStr = value;
    },
  };
}
/** The runtime members interaction reads; it owns every other piece of its state. */
export type InteractionDependencies = Pick<
  GameRuntime,
  | 'clearRemovedContributor'
  | 'commitRoad'
  | 'demolish'
  | 'gameEvents'
  | 'hoverIn'
  | 'ht'
  | 'inB'
  | 'previewGuardPost'
  | 'previewPlacement'
  | 'previewRoad'
  | 'refreshToolView'
  | 'requestDemolitionConfirmation'
  | 'showRemovedContributor'
  | 'updateInfo'
>;
export type InspectionSource = 'advisor' | 'flagged' | 'journey';
export type DemolitionAction = 'missing' | 'armed' | 'confirmed';
export interface InteractionSubsystem {
  activateTool: (mtype: InteractionModeType, bt?: BuildingType | null) => void;
  selectMapTarget: (building: Building | null, tile: TilePoint) => void;
  inspectBuilding: (building: Building | null, source: InspectionSource) => void;
  setMode: (mtype: InteractionModeType | null, bt?: BuildingType | null) => void;
  cancelMode: () => void;
  demolitionInput: (target: Building | null, shift?: boolean) => DemolitionAction;
  roadInput: (tile: TilePoint, shift?: boolean) => void;
  dismissInspector: () => void;
  /** The build tool's placement preview at the hovered site, if any. */
  placementPreview: () => PlacementPreview | null;
  /** The road tool's plan from its anchor to the hovered tile, if any. */
  roadPreview: () => RoadPreview | null;
  /** The new border of a valid guard-post placement at the hovered site, if any. */
  guardPreview: () => GuardPostPreview | null;
  readonly ORDER: string[];
  readonly presentationPrefs: PresentationPreferences;
  selected: Building | null;
  mode: InteractionMode | null;
  anchor: TilePoint | null;
  ghost: PlacementGhost | null;
  selInfo: TilePoint | null;
  demoArm: Building | null;
  flagIdx: number;
  hovT: number;
  hovX: number;
  hovY: number;
  ttStr: string | null;
}
