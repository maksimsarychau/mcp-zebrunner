import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  buildPassRateViewExtra,
  DEFAULT_PASS_RATE_TEMPLATE_ID,
  resolvePassRateTemplateId,
  VIEW_TO_TEMPLATE_ID,
} from '../../src/utils/widget-pass-rate-views.js';
import { buildParamsConfig } from '../../src/utils/widget-sql.js';

describe('widget-pass-rate-views', () => {
  it('defaults to template 8 for pie view', () => {
    assert.equal(resolvePassRateTemplateId('pie'), 8);
    assert.equal(resolvePassRateTemplateId('pie', 8), 8);
  });

  it('maps non-pie views to template ids', () => {
    assert.equal(resolvePassRateTemplateId('line'), VIEW_TO_TEMPLATE_ID.line);
    assert.equal(resolvePassRateTemplateId('bar'), 3);
    assert.equal(resolvePassRateTemplateId('summary'), 14);
  });

  it('honours explicit templateId override', () => {
    assert.equal(resolvePassRateTemplateId('line', 99), 99);
  });

  it('buildPassRateViewExtra sets GROUP_BY for bar/summary', () => {
    assert.equal(buildPassRateViewExtra('bar', { group_by: 'PRIORITY' }).GROUP_BY, 'PRIORITY');
    assert.equal(buildPassRateViewExtra('summary', {}).GROUP_BY, 'BUILD');
  });

  it('buildPassRateViewExtra sets groupingPeriod for line views', () => {
    assert.equal(buildPassRateViewExtra('line', {}).groupingPeriod, 'DAY');
    assert.equal(buildPassRateViewExtra('pie_line', { grouping_period: 'WEEK' }).groupingPeriod, 'WEEK');
  });

  it('buildPassRateViewExtra sets PASSED_VALUE for calendar', () => {
    assert.equal(buildPassRateViewExtra('calendar', { passed_value_threshold: 80 }).PASSED_VALUE, '80');
  });

  it('pie default (pre-v9.2.4) produces template 8 with no viewExtra keys', () => {
    const view = 'pie' as const;
    assert.equal(resolvePassRateTemplateId(view), DEFAULT_PASS_RATE_TEMPLATE_ID);
    assert.equal(resolvePassRateTemplateId(view, undefined), 8);
    const extra = buildPassRateViewExtra(view, {});
    assert.deepEqual(extra, {});

    const paramsConfig = buildParamsConfig({
      period: 'Last 7 Days',
      dashboardName: 'api-verify',
      extra,
    });
    assert.equal(paramsConfig.PERIOD, 'Last 7 Days');
    assert.equal(paramsConfig.GROUP_BY, undefined);
    assert.equal(paramsConfig.groupingPeriod, undefined);
    assert.equal(paramsConfig.PASSED_VALUE, undefined);
  });

  it('bar view adds GROUP_BY PRIORITY by default', () => {
    const extra = buildPassRateViewExtra('bar', {});
    assert.equal(extra.GROUP_BY, 'PRIORITY');
    assert.equal(resolvePassRateTemplateId('bar'), 3);
  });
});
