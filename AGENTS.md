# Agent Instructions

When implementing any new feature in this repository, you must follow these steps:

1. **Document the Feature:** First, clearly document the feature to be implemented.
2. **Create a Task List:** Create a markdown table listing all the tasks required to implement the feature.
3. **Iterative Execution:** Execute the tasks one by one.
4. **Track Progress:** After completing a task, you must mark it as complete by updating the markdown table before moving on to the next task.
5. **Keep Documentation Synchronized:** Whenever an implementation introduces or changes protocol specifications, smart contract interfaces, ZK circuit public inputs, blob formats, fee/economic parameters, CLI commands, or Aggregator/Prover workflows, you must update both:
   - The markdown specification files in `docs/` (e.g., `blob-format.md`, `proof-public-inputs.md`, `snapshot-and-stake.md`, `economics.md`, `decisions.md`, `threat-model.md`).
   - The corresponding topics and articles in the two-pane website documentation portal (`website/docs.html`, plus `website/src/docs-v10.js` if adding or renaming sidebar topic anchors).
   Include documentation updates as an explicit task row in your task table before considering any feature complete.

Create task file in a separate tasks directory. Also add a summary of the feature in the task file and the architecture of the feature.

## Markdown Table Format

Use the following format for tracking tasks:

| Task | Description | Status |
| --- | --- | --- |
| 1 | [Task Description] | Incomplete / Complete |
| 2 | [Task Description] | Incomplete / Complete |
