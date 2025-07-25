import { getAccountIdForRequest } from "@/src/services/loginService";
import { getPersonalRooms } from "@/src/services/personalRoomsService";
import { RequestHandler } from "express";

export const apartmentController: RequestHandler = async (req, res) => {
    const accountId = await getAccountIdForRequest(req);
    const personalRooms = await getPersonalRooms(accountId, "Apartment");
    const response: IApartmentResponse = {};
    if (req.query.backdrop !== undefined) {
        response.NewBackdropItem = personalRooms.Apartment.VideoWallBackdrop = req.query.backdrop as string;
    }
    if (req.query.soundscape !== undefined) {
        response.NewSoundscapeItem = personalRooms.Apartment.Soundscape = req.query.soundscape as string;
    }
    await personalRooms.save();
    res.json(response);
};

interface IApartmentResponse {
    NewBackdropItem?: string;
    NewSoundscapeItem?: string;
}
