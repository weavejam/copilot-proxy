import { test, expect, describe } from "bun:test"

import {
  parseGithubTokenArg,
  parseGithubTokenArgs,
} from "../src/lib/accounts-loader"

describe("parseGithubTokenArg", () => {
  test("1 segment: pure token", () => {
    const entry = parseGithubTokenArg("ghu_abc123", 0, "individual")
    expect(entry).toEqual({
      name: "account-1",
      github_token: "ghu_abc123",
      account_type: "individual",
    })
  })

  test("1 segment: uses index for name", () => {
    const entry = parseGithubTokenArg("ghu_xyz", 2, "individual")
    expect(entry.name).toBe("account-3")
  })

  test("2 segments: name:token", () => {
    const entry = parseGithubTokenArg("personal:ghu_abc", 0, "individual")
    expect(entry).toEqual({
      name: "personal",
      github_token: "ghu_abc",
      account_type: "individual",
    })
  })

  test("2 segments: uses defaultType", () => {
    const entry = parseGithubTokenArg("work:ghu_abc", 0, "business")
    expect(entry.account_type).toBe("business")
  })

  test("3 segments: name:type:token", () => {
    const entry = parseGithubTokenArg("work:business:ghu_abc", 0, "individual")
    expect(entry).toEqual({
      name: "work",
      github_token: "ghu_abc",
      account_type: "business",
    })
  })

  test("3+ segments: token containing colons", () => {
    const entry = parseGithubTokenArg(
      "work:enterprise:ghu_abc:def:ghi",
      0,
      "individual",
    )
    expect(entry).toEqual({
      name: "work",
      github_token: "ghu_abc:def:ghi",
      account_type: "enterprise",
    })
  })
})

describe("parseGithubTokenArgs", () => {
  test("single token", () => {
    const entries = parseGithubTokenArgs("ghu_abc", "individual")
    expect(entries).toHaveLength(1)
    expect(entries[0].github_token).toBe("ghu_abc")
  })

  test("multiple comma-separated tokens", () => {
    const entries = parseGithubTokenArgs(
      "personal:individual:ghu_aaa,work:business:ghu_bbb",
      "individual",
    )
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      name: "personal",
      github_token: "ghu_aaa",
      account_type: "individual",
    })
    expect(entries[1]).toEqual({
      name: "work",
      github_token: "ghu_bbb",
      account_type: "business",
    })
  })

  test("trims whitespace around entries", () => {
    const entries = parseGithubTokenArgs(
      " a:ghu_aaa , b:ghu_bbb ",
      "individual",
    )
    expect(entries).toHaveLength(2)
    expect(entries[0].name).toBe("a")
    expect(entries[1].name).toBe("b")
  })

  test("ignores empty segments from trailing comma", () => {
    const entries = parseGithubTokenArgs("a:ghu_aaa,", "individual")
    expect(entries).toHaveLength(1)
  })

  test("mixed formats", () => {
    const entries = parseGithubTokenArgs(
      "ghu_bare,named:ghu_two,full:business:ghu_three",
      "individual",
    )
    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({
      name: "account-1",
      github_token: "ghu_bare",
      account_type: "individual",
    })
    expect(entries[1]).toEqual({
      name: "named",
      github_token: "ghu_two",
      account_type: "individual",
    })
    expect(entries[2]).toEqual({
      name: "full",
      github_token: "ghu_three",
      account_type: "business",
    })
  })
})
