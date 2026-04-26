import { test, expect, describe } from "bun:test"

import {
  parseGithubTokenArg,
  parseGithubTokenArgs,
} from "../src/lib/accounts-loader"

describe("parseGithubTokenArg", () => {
  test("1 segment: pure token", () => {
    const entry = parseGithubTokenArg("ghu_abc123", 0)
    expect(entry).toEqual({
      name: "account-1",
      github_token: "ghu_abc123",
    })
  })

  test("1 segment: uses index for name", () => {
    const entry = parseGithubTokenArg("ghu_xyz", 2)
    expect(entry.name).toBe("account-3")
  })

  test("2 segments: name:token", () => {
    const entry = parseGithubTokenArg("personal:ghu_abc", 0)
    expect(entry).toEqual({
      name: "personal",
      github_token: "ghu_abc",
    })
  })

  test("token containing colons: first colon splits name", () => {
    const entry = parseGithubTokenArg("work:ghu_abc:def:ghi", 0)
    expect(entry).toEqual({
      name: "work",
      github_token: "ghu_abc:def:ghi",
    })
  })

  test("no account_type is set (auto-detected later)", () => {
    const entry = parseGithubTokenArg("myname:ghu_token", 0)
    expect(entry.account_type).toBeUndefined()
  })
})

describe("parseGithubTokenArgs", () => {
  test("single token", () => {
    const entries = parseGithubTokenArgs("ghu_abc")
    expect(entries).toHaveLength(1)
    expect(entries[0].github_token).toBe("ghu_abc")
  })

  test("multiple comma-separated tokens", () => {
    const entries = parseGithubTokenArgs("personal:ghu_aaa,work:ghu_bbb")
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      name: "personal",
      github_token: "ghu_aaa",
    })
    expect(entries[1]).toEqual({
      name: "work",
      github_token: "ghu_bbb",
    })
  })

  test("trims whitespace around entries", () => {
    const entries = parseGithubTokenArgs(" a:ghu_aaa , b:ghu_bbb ")
    expect(entries).toHaveLength(2)
    expect(entries[0].name).toBe("a")
    expect(entries[1].name).toBe("b")
  })

  test("ignores empty segments from trailing comma", () => {
    const entries = parseGithubTokenArgs("a:ghu_aaa,")
    expect(entries).toHaveLength(1)
  })

  test("mixed formats: bare tokens and named tokens", () => {
    const entries = parseGithubTokenArgs("ghu_bare,named:ghu_two")
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      name: "account-1",
      github_token: "ghu_bare",
    })
    expect(entries[1]).toEqual({
      name: "named",
      github_token: "ghu_two",
    })
  })
})
