"""Editable Blender sources for Break Builder table tennis.

Run in an owned Blender scene, setting BUILD_ASSET to one of:
table-tennis-equipment, cyber-arena, sports-hall.
The caller creates ASSET_ROOT/sources and ASSET_ROOT/models before execution.
Only Blender builtins / Python's math+random / mathutils are used.
"""
import bpy
import bmesh
import math
import random
from mathutils import Vector

# BUILD_ASSET and ASSET_ROOT are mandatory caller-supplied assignments.
random.seed(731)
for scene_object in list(bpy.context.scene.objects):
    bpy.data.objects.remove(scene_object, do_unlink=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1


def material(name, color, roughness=0.4, metallic=0, emission=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1)
        shader.inputs["Emission Strength"].default_value = emission
    return mat


def textured_material(name, color, pattern, roughness=0.5, size=128):
    """Packed image texture survives glTF; no non-exporting procedural nodes."""
    mat = material(name, color, roughness)
    image = bpy.data.images.new(name + "_BaseColor", width=size, height=size, alpha=False)
    pixels = []
    for y in range(size):
        for x in range(size):
            if pattern == "wood":
                grain = math.sin(x * 0.84 + math.sin(y * 0.035) * 1.8)
                fine = math.sin(x * 3.8 + y * 0.065) * 0.18
                value = 0.91 + grain * 0.06 + fine * 0.07 + random.random() * 0.035
            elif pattern == "carbon":
                over = ((x // 8 - y // 8) % 4) < 2
                strand = x % 8 if over else y % 8
                value = 0.67 + 0.22 * math.sin((strand + 0.5) / 8 * math.pi) + (0.1 if over else 0)
            elif pattern == "ball":
                # ABS is a fine satin surface. Large random colour variations
                # read as chalk pits when the 40 mm ball fills a near view.
                value = 0.985 + random.random() * 0.015
            else:
                value = 0.86 + random.random() * 0.14
            pixels.extend((min(1, color[0] * value), min(1, color[1] * value), min(1, color[2] * value), 1))
    image.pixels = pixels
    image.pack()
    image.colorspace_settings.name = "sRGB"
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    mat.node_tree.links.new(node.outputs["Color"], mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"])
    return mat


def group(name):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    return obj


def finish(obj, name, mat, parent=None, bevel=0, smooth=False):
    obj.name = name
    if mat:
        obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("Manufactured edge radius", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        normals = obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
        normals.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=normals.name)
    if smooth:
        for poly in obj.data.polygons:
            poly.use_smooth = True
    obj.parent = parent
    obj.select_set(False)
    return obj


def box(name, at, size, mat, parent=None, bevel=0.006, rotation=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rotation:
        obj.rotation_euler = rotation
    return finish(obj, name, mat, parent, min(bevel, min(size) * 0.24) if bevel else 0)


def cylinder(name, at, radius, depth, mat, parent=None, vertices=24, rotation=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=at)
    obj = bpy.context.object
    if rotation:
        obj.rotation_euler = rotation
    return finish(obj, name, mat, parent, min(radius * 0.09, 0.008), True)


def sphere(name, at, radius, mat, parent=None, segments=32, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=at)
    return finish(bpy.context.object, name, mat, parent, smooth=True)


def beam(name, a, b, width, mat, parent=None, depth=None):
    delta = Vector(b) - Vector(a)
    obj = box(name, (Vector(a) + Vector(b)) / 2, (width, depth or width, delta.length), mat, parent, width * 0.13)
    obj.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    return obj


def tube(name, points, radius, mat, parent=None, cyclic=False, resolution=2):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = resolution
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for entry, point in zip(spline.points, points):
        entry.co = (*point, 1)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return finish(obj, name, mat, parent, smooth=True)


def text(name, content, at, size, mat, parent=None, rotation=(math.pi / 2, 0, 0), extrude=0.0005):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = content
    curve.align_x = "CENTER"
    curve.size = size
    curve.extrude = extrude
    curve.resolution_u = 4
    obj = bpy.data.objects.new(name, curve)
    scene.collection.objects.link(obj)
    obj.location = at
    obj.rotation_euler = rotation
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return finish(obj, name, mat, parent)


def mesh_xz_profile(name, points, center_y, depth, mat, parent):
    n = len(points)
    vertices = [(x, center_y - depth / 2, z) for x, z in points] + [(x, center_y + depth / 2, z) for x, z in points]
    faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
    faces.extend((i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.1519, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)
    return finish(obj, name, mat, parent, bevel=0.0003)


def join_static(root):
    """Keep hero roots separate; merge environment/equipment leaves by material."""
    buckets = {}
    for obj in list(root.children_recursive):
        if obj.type == "MESH" and len(obj.data.materials) == 1:
            buckets.setdefault(obj.data.materials[0].name, []).append(obj)
    for mat_name, objects in buckets.items():
        if len(objects) < 2:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        objects[0].name = root.name + "_" + mat_name
        bpy.ops.object.select_all(action="DESELECT")


metal = material("Satin anodized aluminum", (0.39, 0.46, 0.50), 0.28, 0.82)
dark = material("Graphite powder coat", (0.034, 0.052, 0.067), 0.4, 0.55)
rubber = material("Black traction rubber", (0.013, 0.018, 0.022), 0.79)
white = material("Warm ivory polymer", (0.83, 0.9, 0.92), 0.36, 0.06)
cyan = material("Cyan optical light", (0.035, 0.7, 0.92), 0.25, 0.3, 2.2)
amber = material("Amber optical light", (1.0, 0.39, 0.08), 0.3, 0.15, 1.7)
wood = textured_material("Natural maple grain", (0.66, 0.40, 0.18), "wood", 0.48)


def build_equipment():
    table = group("Table")
    blue = material("Tournament blue matte top", (0.008, 0.055, 0.12), 0.86)
    blue.node_tree.nodes.get("Principled BSDF").inputs["Specular IOR Level"].default_value = 0.16
    edge = material("Layered composite edge", (0.075, 0.09, 0.095), 0.6)
    box("25mm composite tabletop", (0, 0, 0.7475), (1.525, 2.74, 0.025), blue, table, 0.002)
    # A shallow centre seam defines the two folding leaves without interfering with physics.
    box("Folding tabletop centre seam", (0, 0, 0.7601), (1.48, 0.0015, 0.0002), edge, table, 0)
    for x in [-0.7525, 0.7525]:
        box("20mm side line", (x, 0, 0.7603), (0.02, 2.74, 0.0004), white, table, 0)
    for y in [-1.36, 1.36]:
        box("20mm end line", (0, y, 0.7603), (1.485, 0.02, 0.0004), white, table, 0)
    box("3mm doubles centre line", (0, 0, 0.7604), (0.003, 2.70, 0.0004), white, table, 0)
    for x in [-0.743, 0.743]:
        box("Folded aluminum long apron", (x, 0, 0.694), (0.037, 2.69, 0.085), dark, table, 0.004)
        box("Apron edge inlay", (x * 1.028, 0, 0.687), (0.002, 2.48, 0.009), cyan, table, 0)
    for y in [-1.345, 1.345]:
        box("Short apron", (0, y, 0.694), (1.48, 0.037, 0.085), dark, table, 0.004)
    for x in [-0.57, 0.57]:
        for y in [-0.88, 0.88]:
            box("Tapered support upright", (x, y, 0.378), (0.065, 0.055, 0.64), dark, table, 0.006)
            box("Steel leg collar", (x, y, 0.60), (0.077, 0.069, 0.07), metal, table, 0.004)
            cylinder("Adjustable rubber foot", (x, y, 0.044), 0.056, 0.047, rubber, table)
            beam("Diagonal anti-sway stay", (x, y, 0.16), (x * 0.18, y, 0.67), 0.033, metal, table)
        beam("Foot beam", (x, -0.92, 0.14), (x, 0.92, 0.14), 0.046, dark, table)
    for y in [-0.86, 0.86]:
        beam("Transverse crossmember", (-0.59, y, 0.22), (0.59, y, 0.22), 0.042, dark, table)
    for y in [-0.30, 0.30]:
        for x in [-0.43, 0.43]:
            cylinder("Fold-away transport wheel", (x, y, 0.068), 0.047, 0.027, rubber, table, rotation=(math.pi / 2, 0, 0))
            cylinder("Transport wheel hub", (x, y - 0.016, 0.068), 0.020, 0.005, metal, table, rotation=(math.pi / 2, 0, 0))
            beam("Caster mounting fork", (x, y, 0.085), (x, y, 0.18), 0.019, metal, table)
    text("Near apron brand", "BREAK / TT", (0, -1.368, 0.68), 0.037, white, table)
    net = group("Net")
    mesh_mat = material("Woven charcoal net", (0.012, 0.027, 0.035), 0.8)
    net_width = 1.83
    for x in [-net_width / 2, net_width / 2]:
        cylinder("Screw-clamp net post", (x, 0, 0.845), 0.012, 0.18, dark, net)
        box("Net clamp base", (x, 0, 0.765), (0.09, 0.074, 0.034), metal, net, 0.003)
        beam("Bracket arm", (x, 0, 0.765), (math.copysign(0.75, x), 0, 0.765), 0.016, dark, net)
        cylinder("Tension adjustment wheel", (x, -0.05, 0.765), 0.023, 0.010, rubber, net, rotation=(math.pi / 2, 0, 0))
    top = 0.76 + 0.1525
    box("White net top tape", (0, 0, top - 0.007), (net_width, 0.003, 0.015), white, net, 0.0005)
    for i in range(122):
        x = -0.9 + i * 1.8 / 121
        tube("Vertical net filament", [(x, 0, 0.767), (x, 0, top - 0.013)], 0.00055, mesh_mat, net, resolution=0)
    for i in range(10):
        z = 0.77 + i * 0.013
        tube("Horizontal net filament", [(-0.904, 0, z), (0.904, 0, z)], 0.00055, mesh_mat, net, resolution=0)
    ball_mat = textured_material("ABS ball fine satin", (0.98, 0.975, 0.94), "ball", 0.32, 256)
    ball = sphere("Ball", (0.23, -0.30, 0.8), 0.02, ball_mat, segments=40, rings=24)
    ball["diameter_m"] = 0.04
    paddle = group("Paddle")
    paddle["grip_origin"] = "Handle centre; blade +Z; front -Y in Blender"
    contact = group("PaddleContact")
    contact.parent = paddle
    contact.location = (0, -0.0055, 0.139)
    profile = [(math.cos(i * 2 * math.pi / 48) * 0.077, 0.139 + math.sin(i * 2 * math.pi / 48) * 0.086) for i in range(48)]
    dark_ply = material("Walnut cross-laminate", (0.27, 0.135, 0.06), 0.5)
    for i in range(7):
        mesh_xz_profile("Blade ply %d" % (i + 1), profile, (i - 3) * 0.00085, 0.00085, wood if i % 2 == 0 else dark_ply, paddle)
    red = textured_material("Red tacky rubber", (0.57, 0.018, 0.029), "micro", 0.73)
    black_face = textured_material("Black tacky rubber", (0.028, 0.035, 0.038), "micro", 0.76)
    sponge = material("Elastic sponge layer", (0.72, 0.48, 0.23), 0.9)
    for side, face_mat in [(-1, black_face), (1, red)]:
        mesh_xz_profile("Rubber sponge", profile, side * 0.0037, 0.0013, sponge, paddle)
        mesh_xz_profile("Front rubber" if side < 0 else "Back rubber", profile, side * 0.0049, 0.0011, face_mat, paddle)
    box("Flared laminated handle", (0, 0, 0.004), (0.030, 0.022, 0.108), wood, paddle, 0.008)
    carbon = textured_material("Handle woven carbon inlay", (0.08, 0.105, 0.12), "carbon", 0.32)
    for side in [-1, 1]:
        box("Grip carbon channel", (0, side * 0.0112, 0.004), (0.0065, 0.0008, 0.086), carbon, paddle, 0.0003)
        box("Cyan grip index", (0.008, side * 0.0118, -0.030), (0.0025, 0.0005, 0.014), cyan, paddle, 0.0001)
    box("Handle butt cap", (0, 0, -0.051), (0.026, 0.020, 0.005), dark, paddle, 0.002)
    paddle.location = (1.10, -0.48, 0.62)
    paddle.rotation_euler = (0.18, 0, -0.28)
    join_static(table)
    join_static(net)
    join_static(paddle)
    return [table, net, ball, paddle]


def build_cyber():
    arena = group("CyberArena")
    floor = material("Ceramic slate flooring", (0.055, 0.086, 0.11), 0.46, 0.20)
    slate = material("Titanium facade panels", (0.10, 0.16, 0.20), 0.31, 0.66)
    seating = material("Midnight seating fabric", (0.018, 0.063, 0.083), 0.75)
    box("Arena foundation", (0, 0, -0.15), (17, 23, 0.22), dark, arena, 0.1)
    for x in range(-4, 5):
        for y in range(-6, 7):
            box("Precision ceramic floor panel", (x * 1.80, y * 1.70, -0.017), (1.782, 1.682, 0.034), floor, arena, 0.004)
    for x in [-2.8, 2.8]:
        box("Court perimeter light", (x, 0, 0.006), (0.018, 7.3, 0.009), cyan, arena, 0.001)
    for y in [-3.65, 3.65]:
        box("Court end light", (0, y, 0.006), (5.62, 0.018, 0.009), cyan, arena, 0.001)
    for y in [-9, -4.5, 0, 4.5, 9]:
        for side in [-1, 1]:
            x = side * 7.3
            box("Structural pylon", (x, y, 3.3), (0.52, 0.70, 6.6), slate, arena, 0.09)
            box("Pylon floating cap", (x, y, 6.73), (0.91, 1.1, 0.25), dark, arena, 0.06)
            box("Pylon front light spline", (x - side * 0.29, y, 3.2), (0.035, 0.07, 5.65), cyan, arena, 0.005)
            for z in [0.55, 2.1, 4.25, 5.9]:
                box("Machined pylon collar", (x, y, z), (0.62, 0.81, 0.09), metal, arena, 0.018)
        arch = []
        for i in range(25):
            t = math.pi * i / 24
            arch.append((math.cos(t) * 7.3, y, 6.4 + math.sin(t) * 2.35))
        tube("Vault structural arch", arch, 0.13, dark, arena, resolution=2)
        tube("Vault illuminated soffit", [(x, yy - 0.06, z - 0.16) for x, yy, z in arch], 0.024, cyan, arena, resolution=1)
    for side in [-1, 1]:
        for row in range(3):
            x = side * (5.35 + row * 0.61)
            z = 0.24 + row * 0.34
            box("Spectator tier", (x, 0, z / 2), (0.66, 15.4, z), dark, arena, 0.025)
            for col in range(-10, 11):
                y = col * 0.67
                box("Arena seat", (x, y, z + 0.34), (0.43, 0.49, 0.11), seating, arena, 0.035)
                box("Arena seat back", (x + side * 0.18, y, z + 0.61), (0.07, 0.49, 0.44), seating, arena, 0.02)
    for y in [-10.3, 10.3]:
        box("End wall composite", (0, y, 3.35), (14.7, 0.20, 6.7), dark, arena, 0.04)
        for x in [-5.7, -3.1, 3.1, 5.7]:
            box("Geometric wall fin", (x, y * 0.985, 3.2), (0.82, 0.2, 5.1), slate, arena, 0.06, rotation=(0, -math.copysign(0.17, x), 0))
        box("Championship display housing", (0, y * 0.97, 3.92), (4.9, 0.28, 2.2), metal, arena, 0.07)
        box("Championship dark display", (0, y * 0.95, 3.92), (4.65, 0.045, 1.98), rubber, arena, 0.025)
        if y > 0:
            text("Arena wordmark", "BREAK / TT", (0, y * 0.944, 4.1), 0.46, cyan, arena, extrude=0.003)
            text("Championship subtitle", "CYBER CHAMPIONSHIP", (0, y * 0.944, 3.47), 0.19, white, arena, extrude=0.002)
    halo = [(math.cos(i * 2 * math.pi / 96) * 3.75, math.sin(i * 2 * math.pi / 96) * 4.35, 6.5) for i in range(96)]
    tube("Suspended tournament halo chassis", halo, 0.17, slate, arena, cyclic=True)
    tube("Suspended tournament halo emitter", [(x, y, z - 0.18) for x, y, z in halo], 0.045, white, arena, cyclic=True)
    for x in [-2.6, 2.6]:
        for y in [-3, 3]:
            beam("Halo suspension cable", (x, y, 6.58), (x, y, 8.7), 0.012, metal, arena)
    for side in [-1, 1]:
        for y in [-5, 5]:
            box("Broadcast equipment pedestal", (side * 3.7, y, 0.66), (0.48, 0.58, 1.32), slate, arena, 0.08)
            box("Pedestal interactive face", (side * 3.7, y - 0.30, 0.88), (0.36, 0.025, 0.38), cyan, arena, 0.02)
    join_static(arena)
    return [arena]


def build_sports():
    hall = group("SportsHall")
    oak = [textured_material("Maple sports floor %d" % i, (0.63 + i * 0.006, 0.445 + i * 0.004, 0.26 + i * 0.002), "wood", 0.62) for i in range(5)]
    wall = material("Mineral plaster walls", (0.68, 0.72, 0.71), 0.87)
    acoustic = material("Navy acoustic felt", (0.04, 0.105, 0.13), 0.94)
    blue = material("Competition court rubber", (0.025, 0.20, 0.27), 0.82)
    roof = material("Light gray roof panels", (0.38, 0.44, 0.46), 0.72)
    window = material("Diffused daylight clerestory", (0.58, 0.81, 0.92), 0.35, 0, 0.65)
    box("Sprung floor foundation", (0, 0, -0.12), (16, 22, 0.2), dark, hall, 0.04)
    for row in range(40):
        x = -7.8 + row * 0.4
        offset = 0.8 if row % 2 else 0
        for j in range(10):
            y = -10.1 + j * 2.15 + offset
            if y + 1.065 > 11:
                continue
            box("Tongue and groove maple board", (x, y, -0.008), (0.394, 2.136, 0.016), oak[(row + j * 3) % 5], hall, 0.001)
    box("Competition floor mat", (0, 0, 0.004), (6.9, 10.4, 0.008), blue, hall, 0.018)
    for x in [-3.46, 3.46]:
        box("Court mat white perimeter", (x, 0, 0.009), (0.019, 10.42, 0.002), white, hall, 0)
    for y in [-5.21, 5.21]:
        box("Court mat white end", (0, y, 0.009), (6.94, 0.019, 0.002), white, hall, 0)
    for side in [-1, 1]:
        x = side * 8
        box("Long plaster wall", (x, 0, 3.6), (0.24, 22, 7.2), wall, hall, 0.03)
        for y in [-9, -6, -3, 0, 3, 6, 9]:
            box("Structural wall pier", (x - side * 0.18, y, 3.45), (0.33, 0.38, 6.9), white, hall, 0.025)
            box("Perforated acoustic wall panel", (x - side * 0.33, y + 0.8, 1.65), (0.085, 1.05, 2.45), acoustic, hall, 0.018)
            for z in [0.76, 1.15, 1.54, 1.93, 2.32]:
                box("Acoustic panel seam", (x - side * 0.38, y + 0.8, z), (0.012, 0.94, 0.009), dark, hall, 0)
            box("Clerestory glazing", (x - side * 0.17, y + 0.82, 5.2), (0.027, 1.12, 1.82), window, hall, 0.008)
            for yy in [y + 0.23, y + 1.41]:
                box("Window mullion", (x - side * 0.22, yy, 5.2), (0.065, 0.045, 1.98), metal, hall, 0.004)
        for row in range(2):
            xx = side * (5.9 + row * 0.73)
            zz = 0.28 + row * 0.38
            box("Timber spectator terrace", (xx, 0, zz / 2), (0.74, 14, zz), dark, hall, 0.02)
            for y in [-5.8, -2.9, 0, 2.9, 5.8]:
                box("Laminated spectator bench", (xx, y, zz + 0.42), (0.49, 2.65, 0.055), wood, hall, 0.018)
                for yy in [y - 0.95, y + 0.95]:
                    beam("Bench steel support", (xx, yy, zz), (xx, yy, zz + 0.4), 0.032, dark, hall)
    for y in [-11, 11]:
        box("Hall end wall", (0, y, 3.5), (16, 0.23, 7), wall, hall, 0.025)
        for x in [-5.7, 5.7]:
            box("Recessed double door surround", (x, y * 0.987, 1.2), (1.6, 0.16, 2.4), metal, hall, 0.025)
            box("Acoustic door leaves", (x, y * 0.978, 1.18), (1.43, 0.028, 2.21), acoustic, hall, 0.014)
            box("Door central reveal", (x, y * 0.975, 1.18), (0.015, 0.02, 2.22), dark, hall, 0)
        box("Sports scoreboard enclosure", (0, y * 0.985, 4.1), (3.3, 0.16, 1.34), dark, hall, 0.03)
        if y > 0:
            text("Sports hall title", "TABLE TENNIS", (0, y * 0.974, 4.38), 0.28, white, hall)
            text("Centre court identifier", "CENTER COURT", (0, y * 0.974, 3.92), 0.23, amber, hall)
    for y in [-9, -4.5, 0, 4.5, 9]:
        beam("Roof truss lower chord", (-7.9, y, 6.35), (7.9, y, 6.35), 0.085, metal, hall)
        beam("Roof truss upper chord", (-7.9, y, 7.1), (7.9, y, 7.1), 0.085, metal, hall)
        for i in range(12):
            x = -7.8 + i * 1.3
            beam("Roof truss diagonal web", (x, y, 6.38 if i % 2 == 0 else 7.07), (x + 1.3, y, 7.07 if i % 2 == 0 else 6.38), 0.046, dark, hall)
        for x in [-4.7, 0, 4.7]:
            box("Linear luminaire housing", (x, y, 6.12), (1.8, 0.18, 0.13), dark, hall, 0.02)
            box("Linear luminaire diffuser", (x, y, 6.045), (1.69, 0.14, 0.018), white, hall, 0.006)
    for x in [-6, -3, 0, 3, 6]:
        box("Roof cassette", (x, 0, 7.26), (2.97, 22, 0.07), roof, hall, 0.005)
    for y in [-4.9, 4.9]:
        for x in [-2.4, -0.8, 0.8, 2.4]:
            panel = box("Portable playing-area barrier", (x, y, 0.34), (1.53, 0.035, 0.65), acoustic, hall, 0.012)
            for xx in [x - 0.62, x + 0.62]:
                box("Barrier stabilizer", (xx, y, 0.025), (0.035, 0.42, 0.05), dark, hall, 0.008)
    join_static(hall)
    return [hall]


if BUILD_ASSET == "table-tennis-equipment":
    roots = build_equipment()
elif BUILD_ASSET == "cyber-arena":
    roots = build_cyber()
elif BUILD_ASSET == "sports-hall":
    roots = build_sports()
else:
    raise ValueError("Unknown asset: " + str(BUILD_ASSET))
triangle_count = 0
for obj in scene.objects:
    if obj.type == "MESH":
        obj.data.calc_loop_triangles()
        triangle_count += len(obj.data.loop_triangles)
if triangle_count > 200000:
    raise ValueError("Asset exceeds 200k triangle budget: " + str(triangle_count))

# Studio lights and camera are only for source review, excluded from runtime GLB.
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.render.resolution_x = 1440
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.world.color = (0.11, 0.13, 0.16)
def light(name, at, power, size, target):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = at
    obj.rotation_euler = (Vector(target) - Vector(at)).to_track_quat("-Z", "Y").to_euler()
    return obj

if BUILD_ASSET == "table-tennis-equipment":
    cam_at, target = (3.4, -4.4, 2.8), (0, 0, 0.72)
    light("_Preview_Key", (0, -1, 4), 650, 4, (0, 0, 0.7))
    light("_Preview_Fill", (-3, 2, 3), 420, 3, (0, 0, 0.7))
    light("_Preview_Rim", (3, 3, 3), 380, 2, (0, 0, 0.7))
else:
    cam_at, target = (0, -8.4, 3.0), (0, 2.5, 3)
    light("_Preview_CourtKey", (0, 0, 5.8), 1900, 7, (0, 0, 0))
    light("_Preview_NearFill", (-4, -4, 4), 1100, 5, (0, 1, 1))
    light("_Preview_FarFill", (4, 5, 4.5), 1400, 5, (0, 0, 2))
camera_data = bpy.data.cameras.new("_Preview_Camera")
camera = bpy.data.objects.new("_Preview_Camera", camera_data)
scene.collection.objects.link(camera)
camera.location = cam_at
camera.rotation_euler = (Vector(target) - Vector(cam_at)).to_track_quat("-Z", "Y").to_euler()
camera_data.lens = 42 if BUILD_ASSET == "table-tennis-equipment" else 25
scene.camera = camera
for area in bpy.context.screen.areas:
    if area.type == "VIEW_3D":
        area.spaces.active.region_3d.view_perspective = "CAMERA"
        area.spaces.active.shading.type = "MATERIAL"

bpy.ops.object.select_all(action="DESELECT")
for root in roots:
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
scene["asset_authoring"] = "Blender source with bevelled geometry, packed PBR image textures and review camera"
scene["asset_triangles"] = triangle_count
scene["asset_coordinate_system"] = "Meters, Blender Z-up, exported glTF Y-up"
bpy.ops.wm.save_as_mainfile(filepath=ASSET_ROOT + "/sources/" + BUILD_ASSET + ".blend", check_existing=False)
bpy.ops.export_scene.gltf(filepath=ASSET_ROOT + "/models/" + BUILD_ASSET + ".glb", export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_extras=True, export_lights=False, export_cameras=False)
print("ASSET_READY", BUILD_ASSET, "TRIANGLES", triangle_count, "ROOTS", [root.name for root in roots])
