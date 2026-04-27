import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { replaceSection, splitSections } from "@/lib/article/sections";

const SAMPLE = `# Article title

Intro paragraph that lives above the first H2.

## Why it matters

Bullet 1
Bullet 2

## Related concepts

Some related content.

### Subheading kept under H2

More body.

## Conclusion

Wrap up.
`;

describe("splitSections", () => {
  it("splits on ^## and drops the pre-H2 preamble", () => {
    const sections = splitSections(SAMPLE);
    assert.equal(sections.length, 3);
    assert.equal(sections[0]!.heading, "Why it matters");
    assert.equal(sections[1]!.heading, "Related concepts");
    assert.equal(sections[2]!.heading, "Conclusion");
  });

  it("keeps H3+ subheadings inside their parent H2", () => {
    const sections = splitSections(SAMPLE);
    assert.match(sections[1]!.body, /### Subheading kept under H2/);
  });

  it("returns an empty array when no H2 is present", () => {
    assert.deepEqual(splitSections("# title\n\njust prose"), []);
  });
});

describe("replaceSection", () => {
  it("replaces a middle section without disturbing siblings", () => {
    const next = replaceSection(
      SAMPLE,
      "Related concepts",
      "## Related concepts\n\nRewritten body.",
    );
    assert.match(next, /## Why it matters/);
    assert.match(next, /Rewritten body\./);
    assert.match(next, /## Conclusion/);
    assert.doesNotMatch(next, /Some related content/);
  });

  it("replaces the final section even with no trailing H2", () => {
    const next = replaceSection(
      SAMPLE,
      "Conclusion",
      "## Conclusion\n\nNew wrap-up.",
    );
    assert.match(next, /New wrap-up\./);
    assert.doesNotMatch(next, /Wrap up\./);
  });

  it("does not match a heading that is only a prefix", () => {
    const md = "## Foo\nbody-foo\n\n## Foo Bar\nbody-foobar\n";
    const next = replaceSection(md, "Foo", "## Foo\nREPLACED");
    assert.match(next, /## Foo\nREPLACED/);
    assert.match(next, /## Foo Bar\nbody-foobar/);
  });

  it("returns input unchanged when the heading is missing", () => {
    const next = replaceSection(SAMPLE, "Nonexistent", "ignored");
    assert.equal(next, SAMPLE);
  });

  it("round-trips through splitSections", () => {
    const next = replaceSection(
      SAMPLE,
      "Why it matters",
      "## Why it matters\n\nNew body line.",
    );
    const sections = splitSections(next);
    assert.equal(sections.length, 3);
    assert.equal(sections[0]!.heading, "Why it matters");
    assert.match(sections[0]!.body, /New body line\./);
  });
});
