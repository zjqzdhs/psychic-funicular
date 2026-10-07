"""Actual Blender venue preview. Prefix ASSET_ROOT, THEME, OUTPUT_FILE, SOURCE_FILE.

Loads the final environment and equipment; never saves over a canonical asset.
The D-drive SOURCE_FILE retains the composed camera/light inspection scene.
"""
import bpy
from mathutils import Vector

for obj in list(bpy.context.scene.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=ASSET_ROOT+'/models/'+THEME+'.glb')
bpy.ops.import_scene.gltf(filepath=ASSET_ROOT+'/models/table-tennis-equipment.glb')
for name in ['Ball', 'Paddle']:
    obj = bpy.data.objects.get(name)
    if obj:
        for child in [obj]+list(obj.children_recursive):
            child.hide_render = True
            child.hide_set(True)
scene = bpy.context.scene
world = bpy.data.worlds.new('Preview soft environment')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.31,.40,.52,1) if THEME=='cyber-arena' else (.72,.78,.84,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .30 if THEME=='cyber-arena' else .45
scene.world = world
for index,(location,energy,size,color) in enumerate([
    ((0,-1,5.6),700,5,(.88,.95,1)),
    ((-4,-1,3.4),350,4,(.40,.76,1) if THEME=='cyber-arena' else (1,.88,.69)),
    ((3,3,4.8),600,4,(.8,.90,1)),
    ((0,7,5),400,5,(1,.78,.53)),
]):
    data = bpy.data.lights.new('Preview area '+str(index),'AREA')
    data.energy, data.size, data.color = energy,size,color
    lamp = bpy.data.objects.new(data.name,data)
    scene.collection.objects.link(lamp)
    lamp.location = location
    lamp.rotation_euler = (Vector((0,1,.8))-lamp.location).to_track_quat('-Z','Y').to_euler()
data = bpy.data.cameras.new('Venue selection camera')
camera = bpy.data.objects.new(data.name,data)
scene.collection.objects.link(camera)
camera.location = (3.5,-5.6,2.65)
camera.rotation_euler = (Vector((0,.5,1.1))-camera.location).to_track_quat('-Z','Y').to_euler()
data.lens = 31
scene.camera = camera
scene.render.resolution_x,scene.render.resolution_y = 1200,800
scene.render.resolution_percentage = 100
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = .20
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = OUTPUT_FILE
scene['preview_provenance'] = 'Actual Blender composition of the canonical '+THEME+' and table-tennis-equipment GLBs, with authored camera and lights'
bpy.ops.wm.save_as_mainfile(filepath=SOURCE_FILE,check_existing=False)
bpy.ops.render.render(write_still=True)
print('VENUE_PREVIEW_RENDERED',OUTPUT_FILE)
