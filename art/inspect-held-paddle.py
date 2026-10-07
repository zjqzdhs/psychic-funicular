"""MCP inspection with the real equipment attached at the exported GripR.

Prefix ASSET_ROOT, ACTION, FRAME, CLOSEUP ('front'/'back'/'body'/'palm'), SOURCE_FILE.
No canonical asset is modified by this inspection composition.
"""
import bpy
from mathutils import Vector, Matrix

bpy.ops.wm.open_mainfile(filepath=ASSET_ROOT+'/sources/robot-player.blend')
scene=bpy.context.scene
rig=bpy.data.objects['RobotPlayer']
rig.animation_data.action=bpy.data.actions[ACTION]
scene.frame_set(FRAME)
bpy.ops.import_scene.gltf(filepath=ASSET_ROOT+'/models/table-tennis-equipment.glb')
paddle=bpy.data.objects['Paddle']
paddle.parent=bpy.data.objects['GripR']
paddle.matrix_parent_inverse=Matrix.Identity(4)
paddle.matrix_basis=Matrix.Identity(4)
members=[paddle]+list(paddle.children_recursive)
for obj in scene.objects:
    if obj.type=='MESH':
        region='HandL_' if CLOSEUP=='palm' else 'HandR_'
        visible=obj in members or (obj.parent==rig and (CLOSEUP=='body' or obj.name.startswith(region)))
        obj.hide_set(not visible)
        obj.hide_render=not visible
ball=bpy.data.objects.get('Ball')
if ball and ACTION=='ServeHold' and CLOSEUP in ['body','palm']:
    ball.hide_set(False);ball.hide_render=False
    ball.parent=None
    ball.location=bpy.data.objects['PalmL'].matrix_world @ Vector((0,0,.02))
bpy.context.view_layer.update()
grip=bpy.data.objects['GripR'].matrix_world
if CLOSEUP=='palm':
    palm=bpy.data.objects['PalmL'].matrix_world
    target=palm.translation;eye=target+Vector((.2,-.32,.3));lens=63
elif CLOSEUP=='body':
    target=Vector((0,-.05,1.05));eye=Vector((2.0,-3.2,1.9));lens=53
else:
    target=grip @ Vector((0,0,.065))
    offset=Vector((.22,-.34,.16)) if CLOSEUP=='front' else Vector((-.19,.32,.13))
    eye=target+grip.to_3x3() @ offset
    lens=57
data=bpy.data.cameras.new('Held paddle inspection camera')
camera=bpy.data.objects.new(data.name,data);scene.collection.objects.link(camera)
camera.location=eye;camera.rotation_euler=(target-eye).to_track_quat('-Z','Y').to_euler();data.lens=lens
data.clip_start=.005;scene.camera=camera
scene.render.resolution_x=1100;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
for window in bpy.context.window_manager.windows:
    for area in window.screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.shading.type='MATERIAL'
            area.spaces.active.shading.studio_light='studio.exr'
            area.spaces.active.overlay.show_overlays=False
scene['inspection']='Actual canonical equipment with identity Paddle transform on GripR; '+ACTION
bpy.ops.wm.save_as_mainfile(filepath=SOURCE_FILE,check_existing=False)
print('HELD_PADDLE_REVIEW',ACTION,FRAME,CLOSEUP)
print('GRIP_LOCAL',tuple(bpy.data.objects['GripR'].location),tuple(bpy.data.objects['GripR'].rotation_euler))
print('PALM_LOCAL',tuple(bpy.data.objects['PalmL'].location),tuple(bpy.data.objects['PalmL'].rotation_euler))
