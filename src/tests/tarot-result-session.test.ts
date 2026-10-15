import test from 'node:test';
import assert from 'node:assert/strict';
import {
    TAROT_CARDS,
    TAROT_RESULT_PATH,
    TAROT_SPREADS,
    buildTarotDrawHref,
    createTarotDrawSession,
    getTarotResultHrefAfterDraw,
    readTarotDrawRequest,
    type DrawnCard,
    type TarotResultSession,
} from '../lib/divination/tarot';

function searchOf(href: string): URLSearchParams {
    return new URL(href, 'https://taibu.invalid').searchParams;
}

test('tarot draw href round-trips the entry form through the result page address', () => {
    const href = buildTarotDrawHref({ spreadId: 'three-card', question: '  这段关系会如何发展？ ', birthDate: '1990-05-01', allowReversed: false });

    assert.equal(new URL(href, 'https://taibu.invalid').pathname, TAROT_RESULT_PATH);
    assert.deepEqual(readTarotDrawRequest(searchOf(href)), {
        spreadId: 'three-card',
        question: '这段关系会如何发展？',
        birthDate: '1990-05-01',
        allowReversed: false,
    });
});

test('tarot draw href leaves out empty optional fields and the default reversed setting', () => {
    const href = buildTarotDrawHref({ spreadId: 'single', question: '   ', birthDate: '', allowReversed: true });

    assert.equal(href, `${TAROT_RESULT_PATH}?spreadId=single`);
    assert.deepEqual(readTarotDrawRequest(searchOf(href)), { spreadId: 'single', question: '', birthDate: '', allowReversed: true });
});

test('tarot result addresses without spreadId restore from the session instead of drawing', () => {
    assert.equal(readTarotDrawRequest(searchOf(`${TAROT_RESULT_PATH}?from=history&t=1760000000000`)), null);
    assert.equal(readTarotDrawRequest(searchOf(TAROT_RESULT_PATH)), null);
});

test('the address kept after a draw drops every one-shot draw parameter, so a reload does not draw again', () => {
    const drawHref = buildTarotDrawHref({ spreadId: 'celtic-cross', question: '事业方向', birthDate: '1988-12-31', allowReversed: false });
    const afterDraw = getTarotResultHrefAfterDraw(searchOf(drawHref));

    assert.equal(afterDraw, TAROT_RESULT_PATH);
    assert.equal(readTarotDrawRequest(searchOf(afterDraw)), null);
    assert.equal(
        getTarotResultHrefAfterDraw(new URLSearchParams('spreadId=single&utm_source=share&reversed=0')),
        `${TAROT_RESULT_PATH}?utm_source=share`,
    );
});

test('a new draw writes a complete session, so nothing from the previous reading survives the replacement', () => {
    const spread = TAROT_SPREADS.find(item => item.id === 'three-card');
    assert.ok(spread);
    const cards: DrawnCard[] = TAROT_CARDS.slice(0, 3).map((card, index) => ({
        card,
        orientation: index === 1 ? 'reversed' : 'upright',
        position: spread.positions[index]?.name,
    }));
    const session: TarotResultSession = createTarotDrawSession({ spread, cards, seed: 'seed-1' }, { question: '近期运势', birthDate: '' }, '2026-10-13T09:30:00.000Z');

    assert.deepEqual(session, {
        spread,
        spreadId: 'three-card',
        cards,
        question: '近期运势',
        birthDate: '',
        numerology: null,
        seed: 'seed-1',
        readingId: null,
        conversationId: null,
        createdAt: '2026-10-13T09:30:00.000Z',
    });
});
