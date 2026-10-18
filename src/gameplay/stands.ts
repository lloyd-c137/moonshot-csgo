// Final-minute crowd (owner decision 2026-10-17): players who are out for the round sit in the 莲花球场's upper bowl as
// spectators. Seats are assigned in a fixed order over all twelve petals (stadiumLayout.spectatorSeats), so a seat
// carries no information about where its player was. They can cheer, wave a light stick or throw confetti; living
// players see and hear the crowd. GAMEPLAY_AUTHORED.
import type { AppBase, Entity as EntityType } from 'playcanvas';
import { Color, Entity, StandardMaterial } from 'playcanvas';

import type { CharacterAssetLoader } from '../characters/CharacterAssetLoader';
import { attachHeldItemSocket } from '../characters/heldItemSocket';
import type { SeatSlot } from '../world/stadiumLayout';
import { seatAssignment } from '../world/stadiumLayout';

import { hueColour } from './discs';

export type Emote = 'cheer' | 'stick' | 'confetti';
export const EMOTES: readonly Emote[] = ['cheer', 'stick', 'confetti'];
/** How long an emote's action plays (ms). */
const EMOTE_MS: Record<Emote, number> = { cheer: 2600, stick: 3200, confetti: 1500 };

type Fan = {
    character: ReturnType<CharacterAssetLoader['create']>;
    stick: EntityType;
    id: string | null;
    emote: Emote | null;
    emoteUntil: number;
};

export const createStands = (app: AppBase, characters: CharacterAssetLoader, seats: readonly SeatSlot[]) => {
    const fans: Fan[] = [];
    const stickMaterial = new StandardMaterial();
    stickMaterial.diffuse = new Color(1, 0.85, 0.3);
    stickMaterial.emissive = new Color(1, 0.8, 0.25);
    stickMaterial.update();
    const fanAt = (index: number) => {
        let fan = fans[index];
        if (!fan) {
            const character = characters.create({
                name: `stands-fan-${index}`,
                colour: [0.5, 0.5, 0.5],
                gripRightHand: true
            });
            const hand = attachHeldItemSocket(character.root, `stands-fan-${index}-hand`);
            const stick = new Entity(`stands-fan-${index}-stick`);
            stick.addComponent('render', { type: 'cylinder', material: stickMaterial, castShadows: false });
            stick.setLocalScale(0.05, 0.55, 0.05);
            stick.enabled = false;
            hand.addChild(stick);
            character.root.enabled = false;
            app.root.addChild(character.root);
            fan = { character, stick, id: null, emote: null, emoteUntil: 0 };
            fans[index] = fan;
        }
        return fan;
    };
    let assignment = new Map<string, number>();

    return {
        /**
         * Seats the current spectators while `active` (the final minute) and hides the crowd otherwise.
         * `colourOf` gives each player's hue.
         */
        update(
            spectatorIds: readonly string[],
            colourOf: (id: string) => number,
            active: boolean,
            now: number,
            /** The final entrance ceremony: everyone on their feet, waving to the players walking in. */
            waving = false
        ) {
            assignment = active ? seatAssignment(spectatorIds, seats.length) : new Map();
            const used = new Set(assignment.values());
            for (const [id, index] of assignment) {
                const fan = fanAt(index);
                const seat = seats[index];
                if (fan.id !== id) {
                    fan.id = id;
                    fan.emote = null;
                    fan.character.setColour(hueColour(colourOf(id)));
                }
                fan.character.root.enabled = true;
                // Seated pose on the tread; standing up while cheering.
                fan.character.root.setPosition(seat.x, seat.y + (fan.emote === 'cheer' || waving ? 0 : -0.05), seat.z);
                fan.character.root.setEulerAngles(0, seat.yaw, 0);
                if (fan.emote && now >= fan.emoteUntil) fan.emote = null;
                fan.stick.enabled = fan.emote === 'stick';
                fan.character.play(
                    waving && !fan.emote
                        ? 'Idle_Wave_Loop'
                        : fan.emote === 'cheer'
                        ? 'Dance_Loop'
                        : fan.emote === 'stick'
                          ? 'Spell_Simple_Idle_Loop'
                          : fan.emote === 'confetti'
                            ? 'Spell_Simple_Shoot'
                            : 'Sitting_Idle_Loop',
                    0.2
                );
            }
            fans.forEach((fan, index) => {
                if (!used.has(index) && fan.character.root.enabled) {
                    fan.character.root.enabled = false;
                    fan.id = null;
                }
            });
        },
        /** Starts an emote for a seated spectator; returns where it happens (for effects and sound), or null. */
        emote(id: string, kind: Emote, now: number) {
            const index = assignment.get(id);
            if (index === undefined) return null;
            const fan = fanAt(index);
            fan.emote = kind;
            fan.emoteUntil = now + EMOTE_MS[kind];
            const seat = seats[index];
            return [seat.x, seat.y + 1.4, seat.z] as [number, number, number];
        },
        seatOf(id: string): SeatSlot | null {
            const index = assignment.get(id);
            return index === undefined ? null : seats[index];
        },
        get seated() {
            return assignment.size;
        },
        /** Builds one fan and draws it once (call behind the title screen). */
        warm(at: [number, number, number]) {
            const fan = fanAt(0);
            fan.character.root.enabled = true;
            fan.character.root.setPosition(at[0], at[1] - 0.9, at[2]);
            fan.character.play('Sitting_Idle_Loop', 0);
            return () => {
                fan.character.root.enabled = false;
            };
        }
    };
};
