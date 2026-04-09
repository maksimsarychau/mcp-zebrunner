import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  extractFileUuidsFromText,
  replaceFileUuidsInText,
  collectAllFileUuids,
  applyUuidMapping,
  stripFailedFileRefs,
  buildFileTransferReport,
  describeFilePathAttachments,
} from '../../src/helpers/file-refs.js';

describe('file-refs helper', () => {
  const UUID_A = '1879f03e-1146-a931-bccd-5c54c7274f7a';
  const UUID_B = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const UUID_NEW = '99999999-0000-1111-2222-333344445555';

  describe('extractFileUuidsFromText', () => {
    it('extracts a single UUID from inline markdown link', () => {
      const text = `[screenshot](/files/${UUID_A})`;
      const result = extractFileUuidsFromText(text);
      assert.deepEqual(result, [UUID_A]);
    });

    it('extracts multiple UUIDs', () => {
      const text = `See [img1](/files/${UUID_A}) and [img2](/files/${UUID_B})`;
      const result = extractFileUuidsFromText(text);
      assert.equal(result.length, 2);
      assert.ok(result.includes(UUID_A));
      assert.ok(result.includes(UUID_B));
    });

    it('returns empty array when no UUIDs found', () => {
      assert.deepEqual(extractFileUuidsFromText('no files here'), []);
    });

    it('does not match non-UUID patterns', () => {
      assert.deepEqual(extractFileUuidsFromText('/files/not-a-uuid'), []);
    });
  });

  describe('replaceFileUuidsInText', () => {
    it('replaces a known UUID', () => {
      const text = `[img](/files/${UUID_A})`;
      const map = new Map([[UUID_A, UUID_NEW]]);
      const result = replaceFileUuidsInText(text, map);
      assert.equal(result, `[img](/files/${UUID_NEW})`);
    });

    it('leaves unknown UUIDs untouched', () => {
      const text = `[img](/files/${UUID_B})`;
      const map = new Map([[UUID_A, UUID_NEW]]);
      const result = replaceFileUuidsInText(text, map);
      assert.equal(result, text);
    });

    it('replaces multiple occurrences', () => {
      const text = `/files/${UUID_A} and /files/${UUID_A}`;
      const map = new Map([[UUID_A.toLowerCase(), UUID_NEW]]);
      const result = replaceFileUuidsInText(text, map);
      assert.ok(!result.includes(UUID_A));
      assert.equal((result.match(new RegExp(UUID_NEW, 'g')) || []).length, 2);
    });
  });

  describe('collectAllFileUuids', () => {
    it('collects UUIDs from attachments array', () => {
      const payload = {
        attachments: [{ fileUuid: UUID_A }],
      };
      const { attachmentUuids } = collectAllFileUuids(payload);
      assert.deepEqual(attachmentUuids, [UUID_A]);
    });

    it('collects inline UUIDs from text fields', () => {
      const payload = {
        description: `See [img](/files/${UUID_A})`,
        preConditions: `Open [doc](/files/${UUID_B})`,
      };
      const { inlineUuids } = collectAllFileUuids(payload);
      assert.equal(inlineUuids.length, 2);
    });

    it('collects UUIDs from step attachments and step text', () => {
      const payload = {
        steps: [
          {
            action: `Click [img](/files/${UUID_A})`,
            expectedResult: 'result',
            attachments: [{ fileUuid: UUID_B }],
          },
        ],
      };
      const { attachmentUuids, inlineUuids, locations } = collectAllFileUuids(payload);
      assert.equal(attachmentUuids.length, 1);
      assert.equal(inlineUuids.length, 1);
      assert.ok(locations.has(UUID_A));
      assert.ok(locations.has(UUID_B));
    });

    it('returns empty collections for payload with no files', () => {
      const { attachmentUuids, inlineUuids } = collectAllFileUuids({ title: 'test' });
      assert.equal(attachmentUuids.length, 0);
      assert.equal(inlineUuids.length, 0);
    });

    it('collects inline UUIDs from customField TEXT values', () => {
      const payload = {
        customField: {
          notes: `Refer to [doc](/files/${UUID_A})`,
          nonText: 42,
        },
      };
      const { inlineUuids, locations } = collectAllFileUuids(payload);
      assert.equal(inlineUuids.length, 1);
      assert.ok(inlineUuids.includes(UUID_A));
      assert.ok(locations.has(UUID_A));
      const locs = locations.get(UUID_A)!;
      assert.ok(locs.some(l => l.includes('customField.notes')));
    });
  });

  describe('applyUuidMapping', () => {
    it('remaps root attachment UUIDs', () => {
      const payload = {
        attachments: [{ fileUuid: UUID_A }],
      };
      const map = new Map([[UUID_A.toLowerCase(), UUID_NEW]]);
      const result = applyUuidMapping(payload, map);
      assert.deepEqual(result.attachments, [{ fileUuid: UUID_NEW }]);
    });

    it('remaps inline UUIDs in text fields', () => {
      const payload = {
        description: `[img](/files/${UUID_A})`,
        preConditions: `[doc](/files/${UUID_A})`,
      };
      const map = new Map([[UUID_A.toLowerCase(), UUID_NEW]]);
      const result = applyUuidMapping(payload, map);
      assert.ok((result.description as string).includes(UUID_NEW));
      assert.ok((result.preConditions as string).includes(UUID_NEW));
    });

    it('remaps step attachment and inline UUIDs', () => {
      const payload = {
        steps: [
          {
            action: `[img](/files/${UUID_A})`,
            attachments: [{ fileUuid: UUID_B }],
          },
        ],
      };
      const map = new Map([
        [UUID_A.toLowerCase(), UUID_NEW],
        [UUID_B.toLowerCase(), UUID_NEW],
      ]);
      const result = applyUuidMapping(payload, map);
      const steps = result.steps as Array<Record<string, unknown>>;
      assert.ok((steps[0].action as string).includes(UUID_NEW));
      assert.deepEqual(steps[0].attachments, [{ fileUuid: UUID_NEW }]);
    });

    it('does not modify payload when map is empty', () => {
      const payload = { attachments: [{ fileUuid: UUID_A }] };
      const result = applyUuidMapping(payload, new Map());
      assert.deepEqual(result.attachments, [{ fileUuid: UUID_A }]);
    });

    it('remaps inline UUIDs in customField TEXT values', () => {
      const payload = {
        customField: {
          notes: `See [doc](/files/${UUID_A})`,
          count: 5,
        },
      };
      const map = new Map([[UUID_A.toLowerCase(), UUID_NEW]]);
      const result = applyUuidMapping(payload, map);
      const cf = result.customField as Record<string, unknown>;
      assert.ok((cf.notes as string).includes(UUID_NEW));
      assert.equal(cf.count, 5);
    });
  });

  describe('stripFailedFileRefs', () => {
    it('strips failed UUIDs from text fields', () => {
      const payload = {
        description: `before [img](/files/${UUID_A}) after`,
      };
      const { cleanedPayload, warnings } = stripFailedFileRefs(payload, [UUID_A]);
      assert.ok(!(cleanedPayload.description as string).includes(UUID_A));
      assert.ok(warnings.length > 0);
    });

    it('removes failed UUIDs from attachments array', () => {
      const payload = {
        attachments: [{ fileUuid: UUID_A }, { fileUuid: UUID_B }],
      };
      const { cleanedPayload, warnings } = stripFailedFileRefs(payload, [UUID_A]);
      assert.equal((cleanedPayload.attachments as unknown[]).length, 1);
      assert.ok(warnings.some(w => w.includes(UUID_A)));
    });

    it('removes attachments key when all are stripped', () => {
      const payload = {
        attachments: [{ fileUuid: UUID_A }],
      };
      const { cleanedPayload } = stripFailedFileRefs(payload, [UUID_A]);
      assert.equal(cleanedPayload.attachments, undefined);
    });

    it('strips from step attachments and step text', () => {
      const payload = {
        steps: [
          {
            action: `[img](/files/${UUID_A})`,
            attachments: [{ fileUuid: UUID_A }],
          },
        ],
      };
      const { cleanedPayload, warnings } = stripFailedFileRefs(payload, [UUID_A]);
      const steps = cleanedPayload.steps as Array<Record<string, unknown>>;
      assert.ok(!(steps[0].action as string).includes(UUID_A));
      assert.equal(steps[0].attachments, undefined);
      assert.ok(warnings.length >= 2);
    });

    it('does nothing when no failed UUIDs', () => {
      const payload = { description: 'hello' };
      const { cleanedPayload, warnings } = stripFailedFileRefs(payload, []);
      assert.equal(cleanedPayload.description, 'hello');
      assert.equal(warnings.length, 0);
    });

    it('strips failed UUIDs from customField TEXT values', () => {
      const payload = {
        customField: {
          notes: `See [doc](/files/${UUID_A}) for details`,
          count: 10,
        },
      };
      const { cleanedPayload, warnings } = stripFailedFileRefs(payload, [UUID_A]);
      const cf = cleanedPayload.customField as Record<string, unknown>;
      assert.ok(!(cf.notes as string).includes(UUID_A));
      assert.equal(cf.count, 10);
      assert.ok(warnings.some(w => w.includes('customField.notes')));
    });
  });

  describe('buildFileTransferReport', () => {
    it('reports successful transfers', () => {
      const map = new Map([[UUID_A, UUID_NEW]]);
      const locations = new Map([[UUID_A, ['attachments']]]);
      const report = buildFileTransferReport(1, map, [], locations);
      assert.ok(report.includes('1 of 1'));
      assert.ok(report.includes(UUID_NEW));
    });

    it('reports failures', () => {
      const locations = new Map([[UUID_A, ['description']]]);
      const report = buildFileTransferReport(1, new Map(), [UUID_A], locations);
      assert.ok(report.includes('could not be transferred'));
      assert.ok(report.includes(UUID_A));
    });

    it('reports both successes and failures', () => {
      const map = new Map([[UUID_A, UUID_NEW]]);
      const locations = new Map([
        [UUID_A, ['attachments']],
        [UUID_B, ['steps[0].action']],
      ]);
      const report = buildFileTransferReport(2, map, [UUID_B], locations);
      assert.ok(report.includes('1 of 2'));
      assert.ok(report.includes('could not be transferred'));
    });
  });

  describe('describeFilePathAttachments', () => {
    it('describes file_path entries', () => {
      const atts = [
        { file_path: '/tmp/nonexistent-test-file.png' },
        { fileUuid: UUID_A },
      ];
      const lines = describeFilePathAttachments(atts);
      assert.equal(lines.length, 1);
      assert.ok(lines[0].includes('nonexistent-test-file.png'));
      assert.ok(lines[0].includes('file not found'));
    });

    it('returns empty for fileUuid-only entries', () => {
      const atts = [{ fileUuid: UUID_A }];
      const lines = describeFilePathAttachments(atts);
      assert.equal(lines.length, 0);
    });
  });
});
