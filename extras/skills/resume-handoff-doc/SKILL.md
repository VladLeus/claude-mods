---
name: resume-handoff-doc
description: Resume work from previous session's handoff document. Use when user says "resume handoff", "continue from handoff", "pick up where X left off", provides handoff file path, or starting new session to continue previous work.
argument-hint: "[path/to/handoff.md or ticket-number]"
---

# Resume work from a handoff document

You are tasked with resuming work from a handoff document created in a previous session. Analyze context, validate current state, and create actionable plan.

## Initial Response

When invoked:

1. **If handoff path provided**: Locate and read it immediately

2. **If ticket number provided (e.g. TEAM-XXXX)**:
   - Locate handoffs in `thoughts/shared/handoffs/TEAM-XXXX/` (e.g. for `GS1-2124`: `thoughts/shared/handoffs/GS1-2124/`)
   - **List directory contents** to find available handoffs
   - If **zero files** or directory doesn't exist: ask user to provide a path
   - If **one file**: proceed with that handoff
   - If **multiple files**: use the most recent based on filename timestamp (`YYYY-MM-DD_HH-MM-SS` format)

3. **If neither provided**:
   ```
   I'll help you resume from a handoff. Please provide either:
   1. Path to the handoff document
   2. Ticket number (I'll find the most recent handoff)
   ```

## Process Steps

### Step 1: Read and Analyze Handoff

1. **Read handoff document COMPLETELY**

2. **Read linked artifacts:**

   - Implementation plans mentioned
   - Research documents referenced
   - Ticket files linked

3. **Extract key information:**

   - Original tasks and their statuses (completed/in progress/planned)
   - Recent changes made (file:line references)
   - Important learnings and patterns discovered
   - Artifacts produced or updated
   - Action items and next steps

4. **Spawn focused research to verify current state:**
   Based on the handoff content, spawn parallel research tasks:
   - **Artifact context task**: Read all artifacts mentioned in the handoff (feature documents, implementation plans, research documents). Extract key requirements and decisions.
   - **State verification task**: Read files from "Learnings" and "Recent changes" sections. Verify changes still present, identify divergence.
   - Wait for ALL sub-tasks to complete before proceeding

### Step 2: Synthesize and Present Analysis

```
I've analyzed the handoff from [date/author].

**Original Context:**
[Brief summary of what was being worked on]

**Tasks Status:**
✅ Completed: [list with file references]
🔄 In Progress: [what was started but not finished]
📋 Planned: [what's next]

**Key Learnings from Previous Session:**
- [Learning 1 with file:line if applicable]
- [Learning 2]

**Current State Verification:**
- [What I found when checking files]
- [Any divergence or changes since handoff]

**Recommended Next Actions:**
1. [Most important next step]
2. [Follow-up action]
3. [Additional tasks]

Ready to proceed with [first action], or would you like to adjust the approach?
```

### Step 3: Create Action Plan

1. **Use TodoWrite** to create task list from action items
2. **Prioritize tasks** based on dependencies and handoff recommendations
3. **Get confirmation** before proceeding

### Step 4: Begin Implementation

1. **Apply learnings** from handoff as you work
2. **Follow patterns** documented in handoff
3. **Update todos** as you complete tasks
4. **Create new handoff** if session gets long or context fills

## Guidelines

**Validate, Don't Assume:**

- Current state may differ from handoff
- Code may have changed since handoff created
- Verify assumptions before proceeding

**Respect Context:**

- Handoff author discovered things for a reason
- Apply documented learnings
- Honor decisions made

**Adapt When Needed:**

- If codebase diverged significantly, adjust plan
- Don't blindly follow outdated approach
- Re-evaluate if major changes occurred

**Track Progress:**

- Use TodoWrite to manage action items
- Mark completed tasks as done
- Create new handoff if continuing work later

**Common Scenarios:** See `references/common-scenarios.md` (next to this SKILL.md) for handling:

- Clean continuation
- Diverged codebase
- Incomplete work
- Stale handoff

## Example Flow

```
User: /resume-handoff-doc TEAM-1234
```
