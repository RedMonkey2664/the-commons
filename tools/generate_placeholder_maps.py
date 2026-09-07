#!/usr/bin/env python3
"""
Generates the Tiled (.json) maps for The Commons.

Real Tiled 1.10 orthogonal map exports, so Phaser loads them through its normal
tilemap loader and a hand-authored Tiled file drops in with zero code changes.

The tile vocabulary MUST stay in sync with TILE_INDEX in
client/src/art/placeholderArt.ts — same order, same names.

Run:  python tools/generate_placeholder_maps.py
"""

import json
import os
import random

TILE = 32
TILESET_NAME = "commons_city"
TILESET_COLUMNS = 8
TILE_COUNT = 32

# --- tile vocabulary (must match TILE_INDEX in placeholderArt.ts) -----------
GRASS, GRASS_FLOWERS, GRASS_PATCH, PAVING, PAVING_SEAM, PLAZA, PLAZA_ACCENT, PLAZA_INLAY = range(8)
WATER, WATER_RIPPLE, FOUNTAIN_RIM, DECK, GRAVEL, CURB, GRASS_EDGE, MANHOLE = range(8, 16)
WALL, WINDOW, WINDOW_LIT, STOREFRONT, ROOF_EDGE, DOOR_GLASS, PILLAR, AWNING = range(16, 24)
TREE, TREE_SMALL, HEDGE, PLANTER, BENCH, LAMP, FLOWERBED, BOLLARD = range(24, 32)

COLLIDING = {
    WATER, WATER_RIPPLE, FOUNTAIN_RIM,
    WALL, WINDOW, WINDOW_LIT, STOREFRONT, ROOF_EDGE, PILLAR, AWNING,
    TREE, TREE_SMALL, HEDGE, PLANTER, BENCH, LAMP, BOLLARD,
}

AMBIENT = {
    GRASS_FLOWERS: "grassSway",
    FLOWERBED: "grassSway",
    WATER_RIPPLE: "waterShimmer",
    WINDOW_LIT: "windowFlicker",
}

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "maps")


class MapBuilder:
    def __init__(self, width, height, seed=7):
        self.w = width
        self.h = height
        self.ground = [GRASS] * (width * height)
        self.decor = [-1] * (width * height)
        self.objects = []
        self.rng = random.Random(seed)
        self._next_id = 1

    # -- tiles --------------------------------------------------------------
    def _i(self, x, y):
        return y * self.w + x

    def inside(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h

    def set_ground(self, x, y, tile):
        if self.inside(x, y):
            self.ground[self._i(x, y)] = tile

    def set_decor(self, x, y, tile):
        if self.inside(x, y):
            self.decor[self._i(x, y)] = tile

    def fill_ground(self, x0, y0, x1, y1, tile):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set_ground(x, y, tile)

    def fill_decor(self, x0, y0, x1, y1, tile):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set_decor(x, y, tile)

    def outline_decor(self, x0, y0, x1, y1, tile):
        for x in range(x0, x1 + 1):
            self.set_decor(x, y0, tile)
            self.set_decor(x, y1, tile)
        for y in range(y0, y1 + 1):
            self.set_decor(x0, y, tile)
            self.set_decor(x1, y, tile)

    def ground_at(self, x, y):
        return self.ground[self._i(x, y)]

    def decor_at(self, x, y):
        return self.decor[self._i(x, y)]

    def is_free(self, x, y):
        return self.inside(x, y) and self.decor_at(x, y) == -1

    # -- objects ------------------------------------------------------------
    def add_object(self, name, kind, tx, ty, blocks, props=None):
        obj = {
            "height": TILE, "id": self._next_id, "name": name, "rotation": 0,
            "type": "interactable", "visible": True, "width": TILE,
            "x": tx * TILE, "y": ty * TILE,
            "properties": [
                {"name": "kind", "type": "string", "value": kind},
                {"name": "blocks", "type": "bool", "value": blocks},
            ],
        }
        for key, value in (props or {}).items():
            if isinstance(value, bool):
                ptype = "bool"
            elif isinstance(value, int):
                ptype = "int"
            else:
                ptype = "string"
            obj["properties"].append({"name": key, "type": ptype, "value": value})
        self._next_id += 1
        self.objects.append(obj)

    def add_point(self, name, kind, tx, ty):
        self.objects.append({
            "height": 0, "id": self._next_id, "name": name, "point": True,
            "rotation": 0, "type": kind, "visible": True, "width": 0,
            "x": tx * TILE + TILE / 2, "y": ty * TILE + TILE / 2, "properties": [],
        })
        self._next_id += 1

    # -- serialization ------------------------------------------------------
    def tileset(self):
        tiles = {}
        for tid in COLLIDING:
            tiles.setdefault(tid, []).append({"name": "collides", "type": "bool", "value": True})
        for tid, key in AMBIENT.items():
            tiles.setdefault(tid, []).append({"name": "ambient", "type": "string", "value": key})
        return {
            "columns": TILESET_COLUMNS,
            "firstgid": 1,
            "image": "../tilesets/commons_city.png",
            "imageheight": TILE * (TILE_COUNT // TILESET_COLUMNS),
            "imagewidth": TILE * TILESET_COLUMNS,
            "margin": 0, "name": TILESET_NAME, "spacing": 0,
            "tilecount": TILE_COUNT, "tileheight": TILE, "tilewidth": TILE,
            "tiles": [{"id": tid, "properties": props} for tid, props in sorted(tiles.items())],
        }

    def to_json(self):
        return {
            "compressionlevel": -1, "height": self.h, "infinite": False,
            "layers": [
                {"data": [t + 1 for t in self.ground], "height": self.h, "id": 1,
                 "name": "ground", "opacity": 1, "type": "tilelayer", "visible": True,
                 "width": self.w, "x": 0, "y": 0},
                {"data": [0 if t < 0 else t + 1 for t in self.decor], "height": self.h, "id": 2,
                 "name": "decor", "opacity": 1, "type": "tilelayer", "visible": True,
                 "width": self.w, "x": 0, "y": 0},
                {"draworder": "topdown", "id": 3, "name": "objects", "objects": self.objects,
                 "opacity": 1, "type": "objectgroup", "visible": True, "x": 0, "y": 0},
            ],
            "nextlayerid": 4, "nextobjectid": self._next_id,
            "orientation": "orthogonal", "renderorder": "right-down",
            "tiledversion": "1.10.2", "tileheight": TILE,
            "tilesets": [self.tileset()], "tilewidth": TILE,
            "type": "map", "version": "1.10", "width": self.w,
        }


def building(m, x0, y0, x1, y1, door_x=None, door_side="south"):
    """
    A modern glass-and-concrete block: solid plinth, glazed upper floors, a
    parapet along the top, and an optional entrance punched into one face.
    """
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if y == y0:
                tile = ROOF_EDGE
            elif y == y1:
                tile = STOREFRONT
            else:
                # alternate glazing and piers so facades read as real buildings
                tile = WINDOW if (x - x0) % 3 != 2 else WALL
                if tile == WINDOW and (x + y) % 5 == 0:
                    tile = WINDOW_LIT
            m.set_decor(x, y, tile)
            m.set_ground(x, y, PAVING)

    if door_x is not None:
        dy = y1 if door_side == "south" else y0
        m.set_decor(door_x, dy, -1)
        m.set_ground(door_x, dy, PAVING)
    return (door_x, y1 if door_side == "south" else y0)


def build_town_square():
    """
    A modern civic square: paved plaza around a central fountain, glass-fronted
    buildings on three sides, a park gate north, and street furniture throughout.
    """
    W, H = 40, 30
    m = MapBuilder(W, H)

    # ---- ground -----------------------------------------------------------
    # lawn everywhere, then carve the hard landscaping
    for y in range(H):
        for x in range(W):
            m.set_ground(x, y, GRASS)

    # central plaza
    PX0, PY0, PX1, PY1 = 12, 9, 27, 22
    m.fill_ground(PX0, PY0, PX1, PY1, PLAZA)

    # patterned banding inside the plaza
    for x in range(PX0, PX1 + 1):
        m.set_ground(x, PY0, PLAZA_ACCENT)
        m.set_ground(x, PY1, PLAZA_ACCENT)
    for y in range(PY0, PY1 + 1):
        m.set_ground(PX0, y, PLAZA_ACCENT)
        m.set_ground(PX1, y, PLAZA_ACCENT)
    for x in range(PX0 + 2, PX1 - 1):
        m.set_ground(x, PY0 + 2, PLAZA_INLAY)
        m.set_ground(x, PY1 - 2, PLAZA_INLAY)

    # avenues out to each building / gate
    m.fill_ground(4, 15, PX0 - 1, 16, PAVING)        # west avenue
    m.fill_ground(PX1 + 1, 15, 35, 16, PAVING)       # east avenue
    m.fill_ground(19, 3, 20, PY0 - 1, PAVING_SEAM)   # north avenue to the park
    m.fill_ground(19, PY1 + 1, 20, 26, PAVING_SEAM)  # south avenue to the arcade

    # kerbs where paving meets lawn along the avenues
    for x in range(4, PX0):
        m.set_ground(x, 14, CURB)
        m.set_ground(x, 17, GRASS_EDGE)
    for x in range(PX1 + 1, 36):
        m.set_ground(x, 14, CURB)
        m.set_ground(x, 17, GRASS_EDGE)

    m.set_ground(9, 16, MANHOLE)
    m.set_ground(31, 15, MANHOLE)

    # ---- fountain ---------------------------------------------------------
    FX0, FY0, FX1, FY1 = 18, 14, 21, 17
    m.fill_decor(FX0, FY0, FX1, FY1, WATER)
    m.set_decor(FX0 + 1, FY0 + 1, WATER_RIPPLE)
    m.set_decor(FX1 - 1, FY1 - 1, WATER_RIPPLE)
    m.outline_decor(FX0 - 1, FY0 - 1, FX1 + 1, FY1 + 1, FOUNTAIN_RIM)

    # ---- buildings --------------------------------------------------------
    lib_door = building(m, 2, 8, 9, 13, door_x=6, door_side="south")
    cafe_door = building(m, 30, 8, 37, 13, door_x=33, door_side="south")
    arc_door = building(m, 14, 26, 25, 29, door_x=19, door_side="north")

    # forecourt paving in front of each entrance
    m.fill_ground(4, 14, 8, 14, PAVING)
    m.fill_ground(31, 14, 35, 14, PAVING)
    m.fill_ground(17, 24, 22, 25, PAVING)
    m.set_ground(lib_door[0], lib_door[1], PAVING)
    m.set_ground(cafe_door[0], cafe_door[1], PAVING)
    m.set_ground(arc_door[0], arc_door[1], PAVING)

    # awnings flanking the entrances
    for ax in (lib_door[0] - 1, lib_door[0] + 1):
        m.set_decor(ax, lib_door[1], AWNING)
    for ax in (cafe_door[0] - 1, cafe_door[0] + 1):
        m.set_decor(ax, cafe_door[1], AWNING)

    # ---- park gate (north) ------------------------------------------------
    m.fill_ground(19, 0, 20, 2, PAVING_SEAM)
    for x in range(14, 26):
        if x not in (19, 20):
            m.set_decor(x, 2, HEDGE)
    m.set_decor(18, 2, PILLAR)
    m.set_decor(21, 2, PILLAR)

    # ---- landscaping ------------------------------------------------------
    # hedge screens along the plaza's outer corners
    for x in range(PX0, PX0 + 4):
        m.set_decor(x, PY0 - 1, HEDGE)
        m.set_decor(x, PY1 + 1, HEDGE)
    for x in range(PX1 - 3, PX1 + 1):
        m.set_decor(x, PY0 - 1, HEDGE)
        m.set_decor(x, PY1 + 1, HEDGE)

    # benches facing the fountain
    for bx in (16, 23):
        m.set_decor(bx, 13, BENCH)
        m.set_decor(bx, 18, BENCH)

    # lamps at the plaza corners and along the avenues
    for lx, ly in ((13, 10), (26, 10), (13, 21), (26, 21),
                   (8, 14), (31, 14), (19, 8), (20, 23)):
        m.set_decor(lx, ly, LAMP)

    # planters framing the fountain approach
    for px, py in ((17, 12), (22, 12), (17, 19), (22, 19)):
        m.set_decor(px, py, PLANTER)

    # bollards guarding the avenue mouths
    for bx, by in ((11, 15), (11, 16), (28, 15), (28, 16)):
        m.set_decor(bx, by, BOLLARD)

    # street trees lining the avenues
    for x in range(5, 11, 2):
        m.set_decor(x, 13, TREE_SMALL)
        m.set_decor(x, 18, TREE_SMALL)
    for x in range(30, 36, 2):
        m.set_decor(x, 13, TREE_SMALL)
        m.set_decor(x, 18, TREE_SMALL)

    # ---- perimeter parkland ----------------------------------------------
    for y in range(H):
        for x in range(W):
            if x in (0, 1, W - 2, W - 1) or y in (0, 1, H - 2, H - 1):
                if m.is_free(x, y) and m.ground_at(x, y) == GRASS:
                    m.set_decor(x, y, TREE)

    # scattered greenery on the remaining lawn
    for _ in range(420):
        x = m.rng.randrange(2, W - 2)
        y = m.rng.randrange(2, H - 2)
        if m.ground_at(x, y) != GRASS or not m.is_free(x, y):
            continue
        roll = m.rng.random()
        if roll < 0.18:
            m.set_decor(x, y, TREE)
        elif roll < 0.28:
            m.set_decor(x, y, TREE_SMALL)
        elif roll < 0.36:
            m.set_decor(x, y, HEDGE)
        elif roll < 0.44:
            m.set_ground(x, y, FLOWERBED)
        elif roll < 0.62:
            m.set_ground(x, y, GRASS_FLOWERS)
        elif roll < 0.72:
            m.set_ground(x, y, GRASS_PATCH)

    # ---- objects ----------------------------------------------------------
    m.add_point("spawn", "spawn", 19, 20)

    m.add_object("sign_welcome", "signpost", 20, 20, True, {
        "text": "THE COMMONS - civic square.|"
                "Library west, Cafe east, Arcade south, Park north.|"
                "Nothing here is compulsory.",
    })
    m.add_object("sign_library", "signpost", 11, 14, True, {
        "text": "WEST: THE LIBRARY|Focus pods and a reading room. Voices down inside.",
    })
    m.add_object("sign_cafe", "signpost", 28, 14, True, {
        "text": "EAST: THE CAFE|Shared jukebox, warm drinks, loud opinions.",
    })
    m.add_object("sign_park", "signpost", 21, 8, True, {
        "text": "NORTH: THE PARK|Benches and a bandstand. Nothing is required of you here.",
    })
    m.add_object("sign_arcade", "signpost", 18, 23, True, {
        "text": "SOUTH: THE ARCADE|Cabinets, high scores, and the only losing in this town.",
    })

    m.add_object("npc_wanderer", "npc", 15, 16, True, {
        "text": "Oh - hey. I do laps round the fountain while my timer runs.|"
                "Something about a moving avatar makes it easier to sit still.",
    })
    m.add_object("npc_gardener", "npc", 25, 19, True, {
        "text": "The planters are mine. The pigeons are not.|"
                "Mind the wet paint on the east benches.",
    })

    doors = (
        ("door_library", lib_door[0], lib_door[1], "library", "LIBRARY"),
        ("door_cafe", cafe_door[0], cafe_door[1], "cafe", "CAFE"),
        ("door_arcade", arc_door[0], arc_door[1], "arcade", "ARCADE"),
        ("door_park", 19, 1, "park", "PARK"),
    )
    for name, tx, ty, zone, label in doors:
        m.set_decor(tx, ty, -1)
        m.add_object(name, "door", tx, ty, False, {"targetZone": zone, "label": label})

    return m


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.abspath(os.path.join(OUT_DIR, "town_square.json"))
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(build_town_square().to_json(), fh, indent=1)
        fh.write("\n")
    print("wrote", out)


if __name__ == "__main__":
    main()
