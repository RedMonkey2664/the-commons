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
TILE_COUNT = 64

# --- tile vocabulary (must match TILE_INDEX in placeholderArt.ts) -----------
GRASS, GRASS_FLOWERS, GRASS_PATCH, PAVING, PAVING_SEAM, PLAZA, PLAZA_ACCENT, PLAZA_INLAY = range(8)
WATER, WATER_RIPPLE, FOUNTAIN_RIM, DECK, GRAVEL, CURB, GRASS_EDGE, MANHOLE = range(8, 16)
WALL, WINDOW, WINDOW_LIT, STOREFRONT, ROOF_EDGE, DOOR_GLASS, PILLAR, AWNING = range(16, 24)
TREE, TREE_SMALL, HEDGE, PLANTER, BENCH, LAMP, FLOWERBED, BOLLARD = range(24, 32)
WOOD_FLOOR, WOOD_FLOOR_DARK, CARPET, TILE_FLOOR, TILE_FLOOR_ALT, ARCADE_FLOOR, STUDY_FLOOR, STAGE_FLOOR = range(32, 40)
WALL_INT, WALL_SKIRT, WINDOW_INT, COUNTER_FRONT, COUNTER_TOP, BOOKSHELF, SHELF_LOW, NEON_STRIP = range(40, 48)
PATH_DIRT, POND, POND_EDGE, PICNIC_TABLE, FENCE, RUG, CHALKBOARD, KITCHEN_TILE = range(48, 56)
ROOF_DECK, ROOF_RAIL, SKYLINE, STRING_LIGHT, GLASS_WALL, SOIL_BED, FERN, GARDEN_PATH = range(56, 64)

COLLIDING = {
    WATER, WATER_RIPPLE, FOUNTAIN_RIM,
    WALL, WINDOW, WINDOW_LIT, STOREFRONT, ROOF_EDGE, PILLAR, AWNING,
    TREE, TREE_SMALL, HEDGE, PLANTER, BENCH, LAMP, BOLLARD,
    WALL_INT, WALL_SKIRT, WINDOW_INT, COUNTER_FRONT, COUNTER_TOP,
    BOOKSHELF, SHELF_LOW, NEON_STRIP, CHALKBOARD,
    POND, PICNIC_TABLE, FENCE,
    ROOF_RAIL, SKYLINE, GLASS_WALL, SOIL_BED, FERN,
}

AMBIENT = {
    GRASS_FLOWERS: "grassSway",
    FLOWERBED: "grassSway",
    WATER_RIPPLE: "waterShimmer",
    WINDOW_LIT: "windowFlicker",
    POND: "waterShimmer",
    NEON_STRIP: "cabinetFlicker",
    # 10's ambient table, the rest of it.
    KITCHEN_TILE: "cafeSteam",
    SHELF_LOW: "pageTurn",
    STAGE_FLOOR: "bandstandPulse",
    # Phase 6
    STRING_LIGHT: "stringGlow",
    FERN: "grassSway",
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

    # A glasshouse on the north-west lawn, and a lift up to the terrace sharing
    # the cafe block. Both are one step from the square, which 03 asks for
    # explicitly ("never more than one hop from spawn to any zone").
    green_door = building(m, 3, 2, 10, 6, door_x=7, door_side="south")

    # forecourt paving in front of each entrance
    m.fill_ground(4, 14, 8, 14, PAVING)
    m.fill_ground(31, 14, 35, 14, PAVING)
    m.fill_ground(17, 24, 22, 25, PAVING)
    m.set_ground(lib_door[0], lib_door[1], PAVING)
    m.set_ground(cafe_door[0], cafe_door[1], PAVING)
    m.set_ground(arc_door[0], arc_door[1], PAVING)
    # Route to the glasshouse door: one lane along y=7 between the glasshouse
    # and the library roof, then down the gap east of the library to the west
    # avenue. Paved as well as cleared, because the scatter pass runs later and
    # replants any tile still reading as GRASS — a tree at x=9 sealed the door
    # into a pocket the first time. Kept strictly to y=7: clearing y=8 as well
    # punched a walkable hole straight through the library's north wall.
    m.fill_decor(6, 7, 11, 7, -1)
    m.fill_decor(10, 8, 11, 16, -1)
    m.fill_ground(6, 7, 11, 7, PAVING)
    m.fill_ground(10, 8, 11, 16, PAVING)
    m.set_ground(green_door[0], green_door[1], PAVING)

    # The terrace lift is a second street door in the cafe block rather than a
    # building of its own: the terrace IS the roof of that block, and giving it
    # a separate facade elsewhere in the square would say otherwise.
    m.set_decor(36, 13, -1)
    m.set_ground(36, 13, PAVING)
    m.set_ground(36, 14, PAVING)

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
    m.add_object("sign_greenhouse", "signpost", 12, 6, True, {
        "text": "NORTH-WEST: THE GREENHOUSE|Somewhere warm to work. Mind the watering cans.",
    })
    m.add_object("sign_terrace", "signpost", 35, 14, True, {
        "text": "LIFT: THE SKYLINE TERRACE|Roof of the cafe block. Best at dusk.",
    })

    m.add_object("npc_wanderer", "npc", 15, 16, True, {
        "text": "Oh - hey. I do laps round the fountain while my timer runs.|"
                "Something about a moving avatar makes it easier to sit still.",
    })
    m.add_object("npc_gardener", "npc", 25, 19, True, {
        "text": "The planters are mine. The pigeons are not.|"
                "Mind the wet paint on the east benches.",
    })

    # 03 puts the Study Rooms south of the square. The Arcade occupies that
    # facade, so they share the block with a second entrance rather than being
    # pushed somewhere the layout doesn't call for.
    # Clear the approach: the scatter pass above runs first and will happily
    # plant a tree exactly where the entrance path needs to be.
    m.fill_decor(22, 23, 24, 25, -1)
    m.fill_ground(22, 23, 24, 25, PAVING)
    m.set_ground(23, 26, PAVING)

    doors = (
        ("door_library", lib_door[0], lib_door[1], "library", "LIBRARY"),
        ("door_cafe", cafe_door[0], cafe_door[1], "cafe", "CAFE"),
        ("door_arcade", arc_door[0], arc_door[1], "arcade", "ARCADE"),
        ("door_park", 19, 1, "park", "PARK"),
        ("door_study_room", 23, 26, "study_room", "STUDY ROOMS"),
        ("door_greenhouse", green_door[0], green_door[1], "greenhouse", "GREENHOUSE"),
        ("door_skyline_terrace", 36, 13, "skyline_terrace", "TERRACE"),
    )
    for name, tx, ty, zone, label in doors:
        m.set_decor(tx, ty, -1)
        m.add_object(name, "door", tx, ty, False, {"targetZone": zone, "label": label})

    return m


def interior(m, w, h, floor, wall=WALL_SKIRT, windows=()):
    """
    A rectangular room: solid wall ring with a skirting course, floor inside,
    and optional window positions punched into the top wall.
    """
    for y in range(h):
        for x in range(w):
            if x == 0 or y == 0 or x == w - 1 or y == h - 1:
                m.set_ground(x, y, floor)
                m.set_decor(x, y, WALL_INT if y == 0 else wall)
            else:
                m.set_ground(x, y, floor)
    for wx in windows:
        m.set_decor(wx, 0, WINDOW_INT)


def add_exit(m, tx, ty, target, label):
    """A door back out to the square. Walkable; triggers on step."""
    m.set_decor(tx, ty, -1)
    m.set_ground(tx, ty, m.ground_at(tx, ty))
    m.add_object("door_%s" % target, "door", tx, ty, False,
                 {"targetZone": target, "label": label})


def build_library():
    """
    Quiet zone (03).

    Rebuilt in Phase 6. The first pass was one room with two shelf runs and a
    carpet slab in the middle, which read as an empty hall rather than a
    library. This version gives it the thing real libraries have and the old
    one did not: circulation. A central spine runs door to back wall, stacks
    sit either side of it in browsable aisles, and the south end is a reading
    room you arrive into rather than walk past.
    """
    W, H = 28, 20
    m = MapBuilder(W, H, seed=11)
    interior(m, W, H, WOOD_FLOOR, windows=(5, 6, 13, 14, 21, 22))

    # low shelving under the windows along the back wall
    for x in range(2, W - 2):
        if x not in (13, 14):          # keep the spine clear
            m.set_decor(x, 2, SHELF_LOW)

    # Stacks: three runs each side, one tile deep with a walkable aisle
    # between, and a two-tile spine down the middle at x=13..14.
    for y in (4, 6, 8):
        for x in range(2, 12):
            m.set_decor(x, y, BOOKSHELF)
        for x in range(16, W - 2):
            m.set_decor(x, y, BOOKSHELF)

    # reading room in the south half
    m.fill_ground(3, 12, W - 4, 17, CARPET)
    m.fill_ground(12, 12, 15, 16, RUG)

    # issue desk by the entrance
    for x in range(2, 7):
        m.set_decor(x, 16, COUNTER_TOP)
        m.set_decor(x, 17, COUNTER_FRONT)

    # lamps at the reading-room corners, and a noticeboard on the west wall
    m.set_decor(2, 12, LAMP)
    m.set_decor(W - 3, 12, LAMP)
    m.set_decor(1, 10, CHALKBOARD)

    # ---- objects ----------------------------------------------------------
    m.add_point("spawn", "spawn", 14, 17)

    # Pods face the aisles rather than the wall, in the quiet band between the
    # stacks and the reading room.
    for i, x in enumerate((4, 8, 19, 23), start=1):
        m.add_object("focus_pod_%d" % i, "focus_pod", x, 10, True, {
            "text": "A focus pod with a lamp and a power socket.|"
                    "Sitting here starts a timer and tells the room you are working.",
        })

    m.add_object("reading_nook", "reading_nook", 13, 14, True, {
        "text": "A deep armchair on a worn rug, angled away from the door.|"
                "No timer, no goal. Just somewhere to sit near people.",
    })
    for i, (x, y) in enumerate(((7, 13), (20, 13), (7, 16), (20, 16)), start=1):
        m.add_object("reading_seat_%d" % i, "seat", x, y, True, {
            "text": "A reading chair at a shared table.",
        })
    m.add_object("npc_librarian", "npc", 4, 15, True, {
        "text": "Keep it down and you can stay as long as you like.|"
                "Pods are past the stacks. The armchair is first come, first served.",
    })
    add_exit(m, 14, 19, "town_square", "OUT")
    return m


def build_cafe():
    """
    Social zone (03).

    Rebuilt in Phase 6. The first pass was a counter and four loose booths in a
    square room, which gave people nowhere in particular to be. A cafe works by
    having several kinds of place to sit — a bar you perch at, booths you hide
    in, a long table you end up sharing — so this version lays out three, and
    puts the counter where you have to walk past it.
    """
    W, H = 28, 20
    m = MapBuilder(W, H, seed=13)
    interior(m, W, H, TILE_FLOOR, windows=(4, 5, 13, 14, 22, 23))

    # ---- the counter, dead ahead as you come in ---------------------------
    for x in range(3, 14):
        m.set_decor(x, 2, COUNTER_TOP)
        m.set_decor(x, 3, COUNTER_FRONT)
    m.fill_ground(3, 1, 13, 1, KITCHEN_TILE)
    # a gap at the end so staff can get out, and the pastry case beside it
    m.set_decor(13, 3, -1)

    # ---- floor zones ------------------------------------------------------
    # Warm boards down the whole window side, terrazzo through the middle, and
    # rugs under each seating group so the room reads as three places to sit
    # rather than one hall with furniture in it.
    m.fill_ground(17, 4, W - 3, H - 3, WOOD_FLOOR)
    m.fill_ground(9, 9, 14, 13, RUG)
    m.fill_ground(3, 14, 8, 17, RUG)

    # ---- planting, which is most of what makes a cafe feel lived in -------
    for px, py in ((2, 6), (2, 11), (15, 6), (15, 17), (W - 3, 4), (W - 3, 17), (8, 7), (16, 12)):
        m.set_decor(px, py, PLANTER)

    # low shelf of mugs and books against the west wall
    for y in range(8, 12):
        m.set_decor(1, y, SHELF_LOW)

    # ---- objects ----------------------------------------------------------
    m.add_point("spawn", "spawn", 14, 17)

    # 03: "Order a drink - cosmetic-only interaction". Placed at the counter
    # itself rather than on the barista, so ordering is a thing you do at the
    # bar and talking to the barista stays a separate, purely social act.
    m.add_object("drink_counter", "drink_counter", 7, 4, True, {
        "text": "The counter. Someone has chalked today's list above the machine.",
    })
    m.add_object("counter_barista", "npc", 11, 4, True, {
        "text": "Long day? Same.|Drinks are free, they are also imaginary. "
                "Order at the counter, take your time.",
    })
    m.add_object("jukebox", "jukebox", 20, 3, True, {
        "text": "A jukebox, wired to every speaker in the room.|"
                "Whatever is playing, everyone here hears the same thing.",
    })

    # perch seats along the counter
    for i, x in enumerate((4, 6, 8, 10), start=1):
        m.add_object("stool_%d" % i, "seat", x, 5, True, {
            "text": "A stool at the counter. Good for one drink, bad for three hours.",
        })
    # booths against the windows
    for i, (x, y) in enumerate(((19, 7), (24, 7), (19, 13), (24, 13)), start=1):
        m.add_object("booth_%d" % i, "seat", x, y, True, {
            "text": "A booth by the window. Comfortable enough to lose an hour in.",
        })
    # the long shared table, central so you walk into it on the way in
    for i, (x, y) in enumerate(((10, 10), (12, 10), (10, 12), (12, 12)), start=1):
        m.add_object("communal_%d" % i, "seat", x, y, True, {
            "text": "The long table. You will end up talking to whoever sits down.",
        })

    # a quieter pair of small tables in the south-west corner
    for i, (x, y) in enumerate(((4, 15), (7, 15)), start=1):
        m.add_object("corner_table_%d" % i, "seat", x, y, True, {
            "text": "A two-seater in the corner, away from the machine.",
        })

    add_exit(m, 14, 19, "town_square", "OUT")
    return m


def build_arcade():
    """Cabinets are placed from minigames.config at runtime, not baked in (06)."""
    W, H = 22, 16
    m = MapBuilder(W, H, seed=17)
    interior(m, W, H, ARCADE_FLOOR, windows=())

    # neon strips along the side walls
    for y in range(3, 13, 3):
        m.set_decor(0, y, NEON_STRIP)
        m.set_decor(W - 1, y, NEON_STRIP)

    # a prize counter in the corner
    for x in range(2, 7):
        m.set_decor(x, 2, COUNTER_TOP)
        m.set_decor(x, 3, COUNTER_FRONT)

    m.add_point("spawn", "spawn", 11, 14)
    m.add_object("npc_attendant", "npc", 8, 4, True, {
        "text": "Cabinets are along the walls. High scores stick around, "
                "your dignity does not.|"
                "New machines show up whenever someone builds one.",
    })
    add_exit(m, 11, 15, "town_square", "OUT")
    return m


def build_park():
    """Open outdoor hangout: pond, bandstand, benches, least dense zone (03)."""
    W, H = 30, 22
    m = MapBuilder(W, H, seed=19)

    for y in range(H):
        for x in range(W):
            m.set_ground(x, y, GRASS)

    # winding dirt path
    for x in range(4, 26):
        m.set_ground(x, 15, PATH_DIRT)
        m.set_ground(x, 16, PATH_DIRT)
    for y in range(6, 16):
        m.set_ground(14, y, PATH_DIRT)
        m.set_ground(15, y, PATH_DIRT)

    # pond, north-east
    m.fill_decor(20, 5, 25, 9, POND)
    for x in range(19, 27):
        m.set_ground(x, 10, POND_EDGE)
    for x in range(19, 27):
        m.set_ground(x, 4, POND_EDGE)

    # picnic area, west
    for x, y in ((5, 8), (8, 8), (5, 11), (8, 11)):
        m.set_decor(x, y, PICNIC_TABLE)

    # perimeter fence with a gap at the south gate
    for x in range(1, W - 1):
        if x not in (14, 15):
            m.set_decor(x, H - 2, FENCE)
        m.set_decor(x, 1, FENCE)
    for y in range(1, H - 1):
        m.set_decor(1, y, FENCE)
        m.set_decor(W - 2, y, FENCE)

    # benches facing the bandstand
    for bx in (12, 17):
        m.set_decor(bx, 11, BENCH)

    # scattered planting
    for _ in range(180):
        x = m.rng.randrange(2, W - 2)
        y = m.rng.randrange(2, H - 2)
        if m.ground_at(x, y) != GRASS or not m.is_free(x, y):
            continue
        roll = m.rng.random()
        if roll < 0.22:
            m.set_decor(x, y, TREE)
        elif roll < 0.34:
            m.set_decor(x, y, TREE_SMALL)
        elif roll < 0.44:
            m.set_decor(x, y, HEDGE)
        elif roll < 0.58:
            m.set_ground(x, y, GRASS_FLOWERS)
        elif roll < 0.66:
            m.set_ground(x, y, FLOWERBED)

    # bandstand clearing, sized to the structure that stands on it
    m.fill_ground(13, 6, 17, 8, STAGE_FLOOR)
    for x in range(13, 18):
        for y in range(6, 9):
            m.set_decor(x, y, -1)

    m.add_point("spawn", "spawn", 14, 18)
    m.add_object("bandstand", "jukebox", 15, 8, True, {
        "sprite": "obj_bandstand",
        "text": "The bandstand. Same shared queue as the cafe, but out here it is "
                "background rather than the point.",
    })
    for i, (x, y) in enumerate(((12, 11), (17, 11)), start=1):
        m.add_object("bench_%d" % i, "seat", x, y, True, {
            "text": "A bench facing the bandstand.",
        })
    m.add_object("bench_3", "seat", 22, 13, True, {
        "text": "A bench by the pond. Ducks not included.",
    })
    m.add_object("npc_busker", "npc", 18, 12, True, {
        "text": "I play here most evenings.|Nobody has to listen. That is rather "
                "the point of a park.",
    })
    add_exit(m, 14, 20, "town_square", "OUT")
    m.set_ground(14, 20, PATH_DIRT)
    m.set_ground(15, 20, PATH_DIRT)
    return m


def build_study_room():
    """Instanced focus room: desks, a shared timer, deliberately plain (03)."""
    W, H = 18, 14
    m = MapBuilder(W, H, seed=23)
    interior(m, W, H, STUDY_FLOOR, windows=(8, 9))

    m.fill_ground(6, 5, 11, 9, CARPET)

    m.add_point("spawn", "spawn", 9, 12)
    for i, (x, y) in enumerate(((4, 4), (13, 4), (4, 9), (13, 9)), start=1):
        m.add_object("desk_%d" % i, "focus_pod", x, y, True, {
            "sprite": "obj_desk",
            "text": "A desk. Sitting down starts your timer and shows the room "
                    "you are working.",
        })
    m.add_object("shared_timer", "focus_pod", 9, 2, True, {
        "sprite": "obj_shared_timer",
        "text": "The shared timer. Whoever starts it, everyone in the room runs "
                "the same clock.",
    })
    add_exit(m, 9, 13, "town_square", "OUT")
    return m


def build_skyline_terrace():
    """
    Rooftop terrace at dusk (Phase 6).

    Deliberately the least dense zone after the Park: a deck, a rail, the city
    below, and speakers. 03 wants at least one space that asks nothing of you,
    and the Park is that space in daylight; this is the same idea after dark.
    """
    W, H = 24, 17
    m = MapBuilder(W, H, seed=61)

    m.fill_ground(0, 0, W - 1, H - 1, ROOF_DECK)
    # the city beyond, then the rail you cannot cross
    for x in range(W):
        for y in (0, H - 1):
            m.set_decor(x, y, SKYLINE)
    for y in range(H):
        for x in (0, W - 1):
            m.set_decor(x, y, SKYLINE)
    m.outline_decor(1, 1, W - 2, H - 2, ROOF_RAIL)

    # festoon lighting strung across the deck
    for x in range(3, W - 3, 4):
        m.set_ground(x, 3, STRING_LIGHT)
        m.set_ground(x, H - 4, STRING_LIGHT)

    # planted edge softening the north rail, and a small stage
    for x in range(4, W - 4, 3):
        m.set_decor(x, 2, PLANTER)
    m.fill_ground(10, 6, 13, 8, STAGE_FLOOR)

    m.add_point("spawn", "spawn", 12, 13)
    m.add_object("terrace_speakers", "jukebox", 12, 7, True, {
        "text": "Speakers on a stand, wired to the same queue as everywhere else.|"
                "Up here it mostly competes with the traffic.",
    })
    for i, (x, y) in enumerate(((5, 6), (18, 6), (5, 11), (18, 11)), start=1):
        m.add_object("lounger_%d" % i, "seat", x, y, True, {
            "text": "A low chair facing out over the city. Still warm from the day.",
        })
    m.add_object("npc_smoker", "npc", 8, 10, True, {
        "text": "Best view in town and everyone is downstairs arguing about music.|"
                "Their loss. Stay as long as you like.",
    })
    add_exit(m, 12, 15, "town_square", "DOWN")
    return m


def build_greenhouse():
    """
    A working glasshouse (Phase 6).

    The Library is quiet because quiet is enforced; this is quiet because
    nobody raises their voice around plants. Same voice default, different
    reason — which is what stops it being a reskin of the Library.
    """
    W, H = 22, 16
    m = MapBuilder(W, H, seed=67)

    m.fill_ground(0, 0, W - 1, H - 1, GARDEN_PATH)
    m.outline_decor(0, 0, W - 1, H - 1, GLASS_WALL)

    # three long planting beds, each with a gap so both sides stay reachable
    for by in (3, 6, 9):
        for x in range(3, W - 3):
            m.set_decor(x, by, SOIL_BED)
        m.set_decor(W // 2, by, -1)

    for fx, fy in ((2, 5), (2, 8), (W - 3, 5), (W - 3, 8)):
        m.set_decor(fx, fy, FERN)

    # a water channel down the spine, purely for texture
    for y in range(2, H - 3):
        if m.is_free(W // 2, y):
            m.set_ground(W // 2, y, POND_EDGE)

    m.add_point("spawn", "spawn", 11, 13)
    for i, (x, y) in enumerate(((4, 12), (17, 12)), start=1):
        m.add_object("potting_bench_%d" % i, "focus_pod", x, y, True, {
            "text": "A potting bench, cleared of pots.|"
                    "Working here tells the room you are working, same as the Library.",
        })
    m.add_object("garden_nook", "reading_nook", 11, 11, True, {
        "text": "A bench under the vines. Warm, and slightly too humid.|"
                "No timer. Nothing is counted here.",
    })
    m.add_object("npc_grower", "npc", 7, 12, True, {
        "text": "Tomatoes on the left, ambition on the right.|"
                "Sit anywhere. The plants have no opinion.",
    })
    add_exit(m, 11, 15, "town_square", "OUT")
    return m


ZONE_BUILDERS = {
    "town_square": build_town_square,
    "library": build_library,
    "cafe": build_cafe,
    "arcade": build_arcade,
    "park": build_park,
    "study_room": build_study_room,
    "skyline_terrace": build_skyline_terrace,
    "greenhouse": build_greenhouse,
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, builder in ZONE_BUILDERS.items():
        out = os.path.abspath(os.path.join(OUT_DIR, "%s.json" % name))
        with open(out, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(builder().to_json(), fh, indent=1)
            fh.write("\n")
        print("wrote", out)


if __name__ == "__main__":
    main()
