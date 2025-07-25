import { RequestHandler } from "express";
import { getAccountIdForRequest } from "@/src/services/loginService";
import { addMiscItems, getInventory } from "@/src/services/inventoryService";
import { ExportRelics, IRelic } from "warframe-public-export-plus";
import { config } from "@/src/services/configService";

export const projectionManagerController: RequestHandler = async (req, res) => {
    const accountId = await getAccountIdForRequest(req);
    const inventory = await getInventory(accountId);
    const request = JSON.parse(String(req.body)) as IProjectionUpgradeRequest;
    const [era, category, currentQuality] = parseProjection(request.projectionType);
    const upgradeCost = config.dontSubtractVoidTraces
        ? 0
        : qualityNumberToCost[request.qualityTag] - qualityNumberToCost[qualityKeywordToNumber[currentQuality]];
    const newProjectionType = findProjection(era, category, qualityNumberToKeyword[request.qualityTag]);
    addMiscItems(inventory, [
        {
            ItemType: request.projectionType,
            ItemCount: -1
        },
        {
            ItemType: newProjectionType,
            ItemCount: 1
        },
        {
            ItemType: "/Lotus/Types/Items/MiscItems/VoidTearDrop",
            ItemCount: -upgradeCost
        }
    ]);
    await inventory.save();
    res.json({
        prevProjection: request.projectionType,
        upgradedProjection: newProjectionType,
        upgradeCost: upgradeCost
    });
};

interface IProjectionUpgradeRequest {
    projectionType: string;
    qualityTag: number;
}

type VoidProjectionQuality = "VPQ_BRONZE" | "VPQ_SILVER" | "VPQ_GOLD" | "VPQ_PLATINUM";

const qualityNumberToKeyword: VoidProjectionQuality[] = ["VPQ_BRONZE", "VPQ_SILVER", "VPQ_GOLD", "VPQ_PLATINUM"];
const qualityKeywordToNumber: Record<VoidProjectionQuality, number> = {
    VPQ_BRONZE: 0,
    VPQ_SILVER: 1,
    VPQ_GOLD: 2,
    VPQ_PLATINUM: 3
};
const qualityNumberToCost = [0, 25, 50, 100];

// e.g. "/Lotus/Types/Game/Projections/T2VoidProjectionProteaPrimeDBronze" -> ["Lith", "W5", "VPQ_BRONZE"]
const parseProjection = (typeName: string): [string, string, VoidProjectionQuality] => {
    const relic: IRelic | undefined = ExportRelics[typeName];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!relic) {
        throw new Error(`Unknown projection ${typeName}`);
    }
    return [relic.era, relic.category, relic.quality];
};

const findProjection = (era: string, category: string, quality: VoidProjectionQuality): string => {
    return Object.entries(ExportRelics).find(
        ([_, relic]) => relic.era == era && relic.category == category && relic.quality == quality
    )![0];
};
