import { Document, Schema, Types, model } from "mongoose";
import { IShipDatabase } from "@/src/types/shipTypes";
import { toOid } from "@/src/helpers/inventoryHelpers";
import { colorSchema } from "@/src/models/commonModel";
import { IShipInventory } from "@/src/types/inventoryTypes/inventoryTypes";

const shipSchema = new Schema<IShipDatabase>(
    {
        ItemType: String,
        ShipOwnerId: Schema.Types.ObjectId,
        ShipExteriorColors: colorSchema,
        AirSupportPower: String,
        ShipAttachments: { HOOD_ORNAMENT: String },
        SkinFlavourItem: String
    },
    { id: false }
);

shipSchema.virtual("ItemId").get(function () {
    return toOid(this._id);
});

shipSchema.set("toJSON", {
    virtuals: true,
    transform(_document, returnedObject: Record<string, any>) {
        const shipResponse = returnedObject as IShipInventory;
        const shipDatabase = returnedObject as IShipDatabase;
        delete returnedObject._id;
        delete returnedObject.__v;
        delete returnedObject.ShipOwnerId;

        shipResponse.ShipExterior = {
            Colors: shipDatabase.ShipExteriorColors,
            ShipAttachments: shipDatabase.ShipAttachments,
            SkinFlavourItem: shipDatabase.SkinFlavourItem
        };
        delete shipDatabase.ShipExteriorColors;
        delete shipDatabase.ShipAttachments;
        delete shipDatabase.SkinFlavourItem;
    }
});

shipSchema.set("toObject", {
    virtuals: true
});

export const Ship = model("Ships", shipSchema);

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type TShipDatabaseDocument = Document<unknown, {}, IShipDatabase> &
    IShipDatabase & {
        _id: Types.ObjectId;
    } & {
        __v: number;
    };
