import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  maskSecret,
  redactSecretsInString,
} from "../eval/eval-secrets.js";
import { validateVerifiedBearerCredentials } from "../../src/http/bearer-auth-validation.js";

describe("eval-secrets", () => {
  it("maskSecret hides most of the value", () => {
    assert.equal(maskSecret("sk-ant-api03-abcdefghijklmnop"), "***mnop");
    assert.equal(maskSecret(""), "(empty)");
    assert.equal(maskSecret("ab"), "***");
  });

  it("redactSecretsInString strips API key patterns", () => {
    const input =
      "Request failed: Authorization Bearer sk-ant-api03-secretkey123 and OPENAI sk-abc1234567890";
    const out = redactSecretsInString(input);
    assert.match(out, /\[REDACTED\]/);
    assert.doesNotMatch(out, /sk-ant-api03-secretkey123/);
    assert.doesNotMatch(out, /sk-abc1234567890/);
  });

  it("redactSecretsInString strips zebrunner header tokens", () => {
    const out = redactSecretsInString("x-zebrunner-api-token: my-secret-token-value");
    assert.equal(out, "[REDACTED]");
  });
});

describe("validateVerifiedBearerCredentials", () => {
  it("returns trimmed credentials when valid", () => {
    const creds = validateVerifiedBearerCredentials({
      username: "  alice ",
      zebrunnerToken: " token ",
      baseUrl: " https://z.example.com ",
    });
    assert.deepEqual(creds, {
      username: "alice",
      zebrunnerToken: "token",
      baseUrl: "https://z.example.com",
    });
  });

  it("rejects empty username", () => {
    assert.throws(
      () => validateVerifiedBearerCredentials({ username: "", zebrunnerToken: "t" }),
      /username/,
    );
  });

  it("rejects empty token", () => {
    assert.throws(
      () => validateVerifiedBearerCredentials({ username: "u", zebrunnerToken: "  " }),
      /zebrunner token/,
    );
  });

  it("rejects non-http baseUrl", () => {
    assert.throws(
      () =>
        validateVerifiedBearerCredentials({
          username: "u",
          zebrunnerToken: "t",
          baseUrl: "ftp://bad",
        }),
      /baseUrl protocol/,
    );
  });
});
