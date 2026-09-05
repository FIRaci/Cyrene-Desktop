import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { beforeEach, describe, expect, it } from "vitest"

describe("relationship log", () => {
  let filePath: string

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relationship-log-"))
    filePath = path.join(dir, "relationship-log.json")
  })

  it("records relationship cues without asking for confirmation", async () => {
    const { RelationshipLogStore } = await import("./relationship-log")
    const store = new RelationshipLogStore(filePath)

    await store.recordTurn({
      userText: "No memory confirmation cards, they are too intrusive and ruin the experience!",
      assistantText: "Understood, will not do that.",
      cyreneFeeling: "gentle",
      channel: "desktop",
    })

    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      entries: Array<{ userMood: string; relationshipSignal: string; nextCareCue: string }>
      dailySummaries: Array<{ summary: string }>
    }

    expect(data.entries).toHaveLength(1)
    expect(data.entries[0].userMood).toBe("clear boundary")
    expect(data.entries[0].relationshipSignal).toContain("low disturbance")
    expect(data.entries[0].nextCareCue).toContain("Do not pop confirmation")
    expect(data.dailySummaries[0].summary).toContain("clear boundary")
  })

  it("builds a compact context from recent cues", async () => {
    const { RelationshipLogStore } = await import("./relationship-log")
    const store = new RelationshipLogStore(filePath)

    await store.recordTurn({
      userText: "I'm a bit tired today, don't schedule too much for now",
      assistantText: "Then let's take it slowly.",
      cyreneFeeling: "concerned",
      channel: "desktop",
    })

    const context = await store.buildContext()

    expect(context).toContain("[Recent Relationship Cues]")
    expect(context).toContain("User recent state")
    expect(context).toContain("tired")
    expect(context).toContain("Next response cue")
  })
})
