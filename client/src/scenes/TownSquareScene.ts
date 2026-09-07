/**
 * Town Square — the hub and spawn point (03).
 *
 * Note how little is here. Everything this zone does comes from its entry in
 * zones.config.ts and from assets/maps/town_square.json. That is the test of
 * the architecture: if a zone scene starts accumulating logic, the shared
 * behaviour belongs in ZoneScene or the map, not here.
 */

import { getZone } from '@commons/shared';
import { ZoneScene } from './ZoneScene';

export class TownSquareScene extends ZoneScene {
  constructor() {
    super(getZone('town_square'));
  }
}
