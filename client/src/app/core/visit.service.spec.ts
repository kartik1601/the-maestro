import { cleanTag, detectSource } from './visit.service';

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const HOST = 'www.themaestro.co.in';

describe('detectSource', () => {
  it('recognises the redirect Instagram sends bio links through', () => {
    expect(detectSource('https://l.instagram.com/?u=x', SAFARI, HOST)).toBe('instagram');
  });

  it('recognises the in-app browser even when it sends no referrer', () => {
    expect(detectSource('', `${SAFARI} Instagram 350.0.0.21.118`, HOST)).toBe('instagram');
  });

  it('is not fooled by a host that merely contains the name', () => {
    expect(detectSource('https://notinstagram.com/', SAFARI, HOST)).toBe('other');
  });

  it('calls a typed address, or a page turned within the site, direct', () => {
    expect(detectSource('', SAFARI, HOST)).toBe('direct');
    expect(detectSource(`https://${HOST}/poems`, SAFARI, HOST)).toBe('direct');
  });

  it('recognises a search, on any of its country domains', () => {
    expect(detectSource('https://www.google.co.in/', SAFARI, HOST)).toBe('google');
  });

  it('survives a referrer that is not a URL', () => {
    expect(detectSource('not a url', SAFARI, HOST)).toBe('direct');
  });
});

describe('cleanTag', () => {
  it('keeps letters, digits and dashes, lower-cased', () => {
    expect(cleanTag('Story-9Oct')).toBe('story-9oct');
    expect(cleanTag('<b>bio</b>')).toBe('bbiob');
    expect(cleanTag(null)).toBe('');
  });
});
