import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
    SanshiTimeFields,
    toSanshiFormTime,
    useSanshiFormTime,
} from '../components/divination/SanshiFormControls';

const CLOCK_READ_ERROR = 'render must not read the browser clock or time zone';

/** 渲染期间把无参 Date、Date.now 与 Intl.DateTimeFormat 换成会抛错的陷阱，证明首屏标记不依赖运行环境的时间 */
function renderWithoutClock(render: () => string): string {
    const RealDate = globalThis.Date;
    const realDateTimeFormat = Object.getOwnPropertyDescriptor(Intl, 'DateTimeFormat');
    assert.ok(realDateTimeFormat);
    globalThis.Date = new Proxy(RealDate, {
        construct(target, args, newTarget) {
            if (args.length === 0) throw new Error(CLOCK_READ_ERROR);
            return Reflect.construct(target, args, newTarget);
        },
        apply() {
            throw new Error(CLOCK_READ_ERROR);
        },
        get(target, property, receiver) {
            if (property === 'now') {
                return () => {
                    throw new Error(CLOCK_READ_ERROR);
                };
            }
            return Reflect.get(target, property, receiver);
        },
    });
    Object.defineProperty(Intl, 'DateTimeFormat', {
        ...realDateTimeFormat,
        value: () => {
            throw new Error(CLOCK_READ_ERROR);
        },
    });
    try {
        return render();
    } finally {
        globalThis.Date = RealDate;
        Object.defineProperty(Intl, 'DateTimeFormat', realDateTimeFormat);
    }
}

test('toSanshiFormTime splits a local time into 1-based form fields', () => {
    assert.deepEqual(toSanshiFormTime(new Date(2026, 0, 31, 23, 5)), { year: 2026, month: 1, day: 31, hour: 23, minute: 5 });
    assert.deepEqual(toSanshiFormTime(new Date(2026, 11, 1, 0, 0)), { year: 2026, month: 12, day: 1, hour: 0, minute: 0 });
});

test('useSanshiFormTime server-renders a fixed placeholder without reading the clock or time zone', () => {
    function FormTimeProbe() {
        const formTime = useSanshiFormTime();
        return createElement('output', null, JSON.stringify({
            value: formTime.value,
            isNow: formTime.isNow,
            timeZone: formTime.timeZone,
        }));
    }

    const html = renderWithoutClock(() => renderToString(createElement(FormTimeProbe)));
    const rendered = JSON.parse(html.replace(/^<output>|<\/output>$/g, '').replace(/&quot;/g, '"'));

    assert.deepEqual(rendered, {
        value: { year: 2000, month: 1, day: 1, hour: 0, minute: 0 },
        isNow: true,
        timeZone: 'Asia/Shanghai',
    });
});

test('entry time fields server-render the placeholder in 正时 state without reading the clock', () => {
    function EntryTimeFields() {
        const formTime = useSanshiFormTime();
        return createElement(SanshiTimeFields, {
            label: '起局时间',
            value: formTime.value,
            isNow: formTime.isNow,
            onFieldChange: formTime.setField,
            onUseNow: formTime.resetToNow,
        });
    }

    const html = renderWithoutClock(() => renderToString(createElement(EntryTimeFields)));

    assert.match(html, /aria-label="起局时间"/);
    assert.match(html, /aria-pressed="true"/);
    for (const [unit, value] of [['年', '2000'], ['月', '1'], ['日', '1'], ['时', '0'], ['分', '0']] as const) {
        assert.match(html, new RegExp(`aria-label="${unit}"[^>]*value="${value}"`, 'u'));
    }
});
