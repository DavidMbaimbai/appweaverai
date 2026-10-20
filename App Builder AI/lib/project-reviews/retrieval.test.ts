import { describe, expect, it } from 'vitest';

import { searchKnowledge, tokenize } from './retrieval';

const docs = [
  { id: '1', title: 'Opening hours', content: 'We are open Monday to Friday from 9am to 5pm.' },
  { id: '2', title: 'Delivery', content: 'Delivery takes 2-3 business days within the country.' },
  { id: '3', title: 'Pets', content: 'Dogs are welcome on the terrace.' },
];

describe('searchKnowledge', () => {
  it('ranks the relevant doc first', () => {
    expect(searchKnowledge('When are you open on Monday?', docs)[0].id).toBe('1');
    expect(searchKnowledge('how long does delivery take', docs)[0].id).toBe('2');
  });

  it('returns nothing when no terms match', () => {
    expect(searchKnowledge('do you sell guitars', docs)).toEqual([]);
    expect(searchKnowledge('the and of', docs)).toEqual([]);
    expect(searchKnowledge('hours', [])).toEqual([]);
  });

  it('respects the limit and stems simple plurals', () => {
    expect(searchKnowledge('delivery hours dogs', docs, 2)).toHaveLength(2);
    expect(tokenize('Dogs are welcome')).toEqual(['dog', 'welcome']);
  });
});
