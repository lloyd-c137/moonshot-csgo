"""Author paired, baked Boomerang finisher actions on the existing Quaternius rig.

Usage (Blender 4.5.x):
  blender --background --python tools/prepareFinisherAnimation.py -- \
    public/assets/characters/moonshot-humanoid.glb \
    public/assets/characters/moonshot-humanoid.glb \
    assets/source/characters/Finisher_Boomerang.blend

The saved .blend contains both staged actors and the animated disc. The runtime GLB
exports the two independently playable actions on the unchanged production rig.
All authored keyframes are local bone transforms; actor root motion is intentionally absent.
"""

import bpy
import math
import os
import sys
from mathutils import Euler, Vector


FPS = 30
END_FRAME = 78  # frames 0–78 are exactly 2.6 seconds at 30 fps


def args():
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 3:
        raise SystemExit("Expected SOURCE.glb OUTPUT.glb PAIRED_SCENE.blend")
    return values


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def find_rig():
    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    mesh = next(
        (obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.find_armature() == armature),
        None,
    )
    if armature is None or mesh is None:
        raise RuntimeError("Input GLB does not contain the expected skinned Quaternius mannequin")
    required = {"root", "pelvis", "spine_01", "spine_02", "spine_03", "Head", "upperarm_r", "lowerarm_r", "hand_r", "upperarm_l", "lowerarm_l", "hand_l", "thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r"}
    missing = required - set(armature.data.bones.keys())
    if missing:
        raise RuntimeError(f"Rig is missing expected bones: {sorted(missing)}")
    return armature, mesh


def pose_keys(rig, action_name, poses):
    """poses are (frame, {bone: (rx, ry, rz)}), rotations in radians."""
    # Start from the real imported idle pose; otherwise unkeyed bones fall back to the
    # library's T-pose. All channels are quaternion keyed to match the source GLB rig.
    idle = next(
        (action for action in bpy.data.actions if action.name.split("|")[-1] == "Idle_Loop"),
        None,
    )
    if idle is None:
        raise RuntimeError("The source character has no Idle_Loop action")
    rig.animation_data_create()
    rig.animation_data.action = idle
    bpy.context.scene.frame_set(round((idle.frame_range[0] + idle.frame_range[1]) / 2))
    bpy.context.view_layer.update()
    base_pose = {bone.name: bone.rotation_quaternion.copy() for bone in rig.pose.bones}
    action = bpy.data.actions.new(action_name)
    rig.animation_data.action = action
    for frame, rotations in poses:
        sample_frame = frame - 1
        bpy.context.scene.frame_set(sample_frame)
        for bone in rig.pose.bones:
            bone.rotation_mode = "QUATERNION"
            bone.rotation_quaternion = base_pose[bone.name]
            if bone.name in rotations:
                bone.rotation_quaternion = base_pose[bone.name] @ rotations[bone.name]
            bone.keyframe_insert(data_path="rotation_quaternion", frame=sample_frame, group=bone.name)
        root = rig.pose.bones.get("root")
        root.location = (0, 0, 0)
        root.keyframe_insert(data_path="location", frame=sample_frame, group="root")
    for curve in action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "BEZIER"
            key.handle_left_type = "AUTO_CLAMPED"
            key.handle_right_type = "AUTO_CLAMPED"
    action.use_fake_user = True
    return action


def paired_actions(rig):
    rot = lambda values: Euler(values, "XYZ").to_quaternion()
    attacker = pose_keys(
        rig,
        "Finisher_Boomerang_Attacker",
        [
            (1, {}),
            # 0–450 ms: The Flip. Load the throwing shoulder, then send the right hand overhead.
            (14, {"spine_02": rot((0.08, 0, -0.12)), "spine_03": rot((0.12, 0, -0.16)), "Head": rot((0.06, 0, -0.18)), "upperarm_r": rot((0.05, -0.2, -1.35)), "lowerarm_r": rot((0.0, -0.1, -0.42)), "upperarm_l": rot((-0.12, 0.1, 0.68)), "lowerarm_l": rot((0.08, 0.0, 0.08))}),
            # 450–1150 ms: The Orbit. Counter-rotate and track the returning disc.
            (35, {"spine_02": rot((-0.08, 0.04, 0.18)), "spine_03": rot((-0.12, 0.04, 0.24)), "Head": rot((-0.08, 0, 0.42)), "upperarm_r": rot((-0.15, -0.2, -1.2)), "lowerarm_r": rot((0.0, -0.1, -1.0)), "upperarm_l": rot((0.16, 0.1, 0.62)), "lowerarm_l": rot((0.12, 0.0, -0.1))}),
            # 1150–1650 ms: The Catch. Reach across the back with an open, braced hand.
            (50, {"spine_02": rot((0.06, 0.12, -0.22)), "spine_03": rot((0.08, 0.08, -0.28)), "Head": rot((0.0, 0.04, -0.25)), "upperarm_r": rot((0.15, -0.25, -0.72)), "lowerarm_r": rot((0.1, -0.15, -1.18)), "hand_r": rot((0.0, 0.0, 0.08)), "upperarm_l": rot((-0.12, 0.12, 0.55)), "lowerarm_l": rot((0.08, 0.0, 0.12))}),
            # 1650–2150 ms: The Finish. Rotate through the torso and release into a clean follow-through.
            (65, {"spine_02": rot((-0.12, -0.08, 0.26)), "spine_03": rot((-0.16, -0.06, 0.32)), "Head": rot((0.04, 0, 0.18)), "upperarm_r": rot((-0.12, -0.2, -1.28)), "lowerarm_r": rot((-0.1, -0.1, -0.36)), "hand_r": rot((0.0, 0.0, -0.08)), "upperarm_l": rot((0.12, 0.12, 0.62)), "lowerarm_l": rot((0.08, 0.0, 0.1)), "thigh_l": rot((0.03, 0.0, 0)), "thigh_r": rot((-0.03, 0.0, 0))}),
            # 2150–2600 ms: The Pose. Recover balance, settle both feet and return the disc to the hand.
            (79, {"spine_02": rot((0.02, 0, -0.04)), "spine_03": rot((0.02, 0, -0.06)), "Head": rot((0, 0, 0)), "upperarm_r": rot((0.04, -0.12, -0.12)), "lowerarm_r": rot((0.0, -0.08, -0.08)), "hand_r": rot((0, 0, 0)), "upperarm_l": rot((0, 0.08, 0.1)), "lowerarm_l": rot((0.06, 0, 0))}),
        ],
    )
    victim = pose_keys(
        rig,
        "Finisher_Boomerang_Victim",
        [
            (1, {}),
            (14, {"Head": rot((0.04, 0, 0)), "spine_02": rot((0, 0, 0.02))}),
            # Track the disc as it sweeps past the face.
            (35, {"Head": rot((0.0, 0.08, 0.48)), "spine_02": rot((0.02, 0.02, 0.12)), "spine_03": rot((0.02, 0, 0.14)), "upperarm_l": rot((-0.22, 0.12, 0.85)), "lowerarm_l": rot((0.15, 0, 0.25)), "upperarm_r": rot((-0.18, -0.12, -0.85)), "lowerarm_r": rot((0.15, 0, -0.25))}),
            # Catch beat: recoil begins only at the contact pose.
            (50, {"Head": rot((-0.14, 0, -0.22)), "spine_02": rot((-0.1, 0.02, -0.18)), "spine_03": rot((-0.16, 0.02, -0.2)), "upperarm_l": rot((-0.42, 0.12, 1.05)), "lowerarm_l": rot((0.2, 0, 0.3)), "upperarm_r": rot((-0.35, -0.1, -1.05)), "lowerarm_r": rot((0.18, 0, -0.3))}),
            # Finishing strike: controlled upper-body recoil, knees absorb impact.
            (65, {"root": rot((0.16, 0, 0)), "Head": rot((-0.22, 0, -0.12)), "spine_02": rot((-0.22, 0, -0.08)), "spine_03": rot((-0.28, 0, -0.1)), "upperarm_l": rot((-0.5, 0.08, 0.95)), "upperarm_r": rot((-0.46, -0.08, -0.95)), "thigh_l": rot((0.1, 0, 0)), "thigh_r": rot((0.12, 0, 0)), "calf_l": rot((-0.18, 0, 0)), "calf_r": rot((-0.2, 0, 0))}),
            (79, {"root": rot((0.72, 0, 0.08)), "pelvis": rot((0.12, 0, 0)), "spine_01": rot((0.22, 0, 0)), "Head": rot((-0.32, 0, -0.08)), "spine_02": rot((0.34, 0, -0.08)), "spine_03": rot((0.32, 0, -0.06)), "upperarm_l": rot((-0.24, 0.04, 0.54)), "upperarm_r": rot((-0.28, -0.04, -0.5)), "thigh_l": rot((0.42, 0, 0)), "thigh_r": rot((0.35, 0, 0)), "calf_l": rot((-0.92, 0, 0)), "calf_r": rot((-0.86, 0, 0))}),
        ],
    )
    return attacker, victim


def duplicate_actor(rig, mesh, name, action, x):
    copy_rig = rig.copy()
    copy_rig.data = rig.data.copy()
    copy_rig.name = name + "_Armature"
    copy_rig.location.x = x
    bpy.context.collection.objects.link(copy_rig)
    copy_mesh = mesh.copy()
    copy_mesh.data = mesh.data
    copy_mesh.name = name + "_Mannequin"
    copy_mesh.parent = copy_rig
    copy_mesh.location = mesh.location.copy()
    copy_mesh.rotation_euler = mesh.rotation_euler.copy()
    copy_mesh.scale = mesh.scale.copy()
    for modifier in copy_mesh.modifiers:
        if modifier.type == "ARMATURE":
            modifier.object = copy_rig
    bpy.context.collection.objects.link(copy_mesh)
    copy_rig.animation_data_create()
    copy_rig.animation_data.action = action
    return copy_rig, copy_mesh


def add_staged_disc():
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.135, depth=0.025, location=(0, 0, 1.45))
    disc = bpy.context.object
    disc.name = "Finisher_Disc_Animation_Prop"
    bevel = disc.modifiers.new("Rounded disc rim", "BEVEL")
    bevel.width = 0.012
    bevel.segments = 3
    disc.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    material = bpy.data.materials.new("Finisher disc | visual reference")
    material.diffuse_color = (0.88, 0.7, 0.18, 1)
    disc.data.materials.append(material)
    for frame, location, rotation in [
        (1, (-1, 0, 1.5), (0, 0, 0)),
        (14, (-1, 0, 2.05), (0, 0, math.radians(45))),
        (35, (0, 0, 2.45), (math.radians(180), 0, math.radians(540))),
        (50, (0.76, 0, 1.75), (math.radians(360), 0, math.radians(900))),
        (65, (0.3, 0, 1.7), (math.radians(540), 0, math.radians(1260))),
        (79, (-1, 0, 1.48), (math.radians(720), 0, math.radians(1620))),
    ]:
        disc.location = location
        disc.rotation_euler = rotation
        disc.keyframe_insert(data_path="location", frame=frame - 1)
        disc.keyframe_insert(data_path="rotation_euler", frame=frame - 1)
    return disc


def add_stage_camera():
    bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, -0.012))
    floor = bpy.context.object
    floor.name = "GAMEPLAY_AUTHORED_Finisher_Stage_Floor"
    material = bpy.data.materials.new("Finisher stage neutral floor")
    material.diffuse_color = (0.07, 0.09, 0.1, 1)
    floor.data.materials.append(material)
    bpy.ops.object.camera_add(location=(0, -7, 2.35))
    camera = bpy.context.object
    camera.name = "Finisher_Review_Camera"
    camera.rotation_euler = (Vector((0, 0, 1.0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 45
    bpy.context.scene.camera = camera
    for name, position, power, size in [
        ("Review_Key", (-3, -4, 5), 900, 5),
        ("Review_Fill", (3, -2, 3), 650, 4),
        ("Review_Rim", (0, 2, 4), 800, 3),
    ]:
        bpy.ops.object.light_add(type="AREA", location=position)
        light = bpy.context.object
        light.name = name
        light.data.energy = power
        light.data.shape = "DISK"
        light.data.size = size
        light.rotation_euler = (Vector((0, 0, 1.0)) - light.location).to_track_quat("-Z", "Y").to_euler()


def main():
    source, output, blend_path = args()
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=source)
    rig, mesh = find_rig()
    actions = paired_actions(rig)
    # Pair both distinct performers in this authoring scene; the GLB runtime export
    # below returns the production rig to its origin and carries both rig-compatible clips.
    rig.name = "Boomerang_Attacker_Armature"
    mesh.name = "Boomerang_Attacker_Mannequin"
    rig.location.x = -1.05
    duplicate_actor(rig, mesh, "Boomerang_Victim", actions[1], 1.05)
    rig.animation_data.action = actions[0]
    add_staged_disc()
    for obj in list(scene_obj for scene_obj in bpy.context.scene.objects if scene_obj.name in {"Cube", "Icosphere"}):
        bpy.data.objects.remove(obj, do_unlink=True)
    add_stage_camera()
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = END_FRAME
    scene.frame_set(0)
    scene["asset"] = "THE BOOMERANG"
    scene["license"] = "Quaternius Universal Animation Library Standard, CC0-1.0"
    scene["authoring_note"] = "Paired bone actions and prop path authored in one Blender scene; actor root motion is disabled."
    os.makedirs(os.path.dirname(blend_path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    # Runtime character GLB: export only the production mannequin and its original armature,
    # with both new action clips included. The scene's second actor and prop stay in the .blend source.
    bpy.ops.object.select_all(action="DESELECT")
    rig.location.x = 0
    bpy.context.view_layer.update()
    rig.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=output,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_skins=True,
        export_apply=False,
    )
    print(f"Exported paired authoring scene and actions: {[action.name for action in actions]} -> {output}")


if __name__ == "__main__":
    main()
