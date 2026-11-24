# Local project instructions

Before modifying T3 Code in Codex or Claude Personal, invoke `$t3-code-modifications` (T3 Code Modifications). Read its workflow before editing and follow the current repository instructions. The skill is managed in `/Users/viktorrudi/Documents/Repositories/private/skills/other/t3-code-modifications/SKILL.md` and is available only in those personal profiles.

Keep the code we add separate and easy to maintain so future upstream T3 Code updates are easy to integrate. Prefer small modules and minimal changes to upstream files. Keep unrelated customizations in separate commits, and preserve them when updating.

Follow the app's existing visual style, components, design tokens, terminology, and architecture.

For requests about **T3 Code Personal** on iPhone, follow the [personal iOS fork release workflow](apps/mobile/README.md#private-updates-through-testflight). Use the latest reviewed personal iOS release commit as the baseline. A request in this project is enough to start implementation, focused checks, Claude Opus 5.5 on Claude Personal review, and release preparation. Carry the reviewed build through the user's authorized delivery path and report the stage verified. Keep your checkout isolated from the running Mac installation.
