const { pinyin: pinyinLib } = require('pinyin');
const jsPinyin = require('js-pinyin');

function cleanText(text) {
  return text.replace(/[\r\n]/g, '').replace(/\s+/g, ' ');
}

function getChinglishKey(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  return /^[a-z]$/i.test(value) ? value.toUpperCase() : value;
}

function segmentText(text) {
  const characters = [];
  const parts = text.split(/([a-zA-Z]+)/);

  for (const part of parts) {
    if (!part) continue;

    if (/^[a-zA-Z]+$/.test(part)) {
      characters.push(part.toUpperCase());
      continue;
    }

    const cleaned = part.toUpperCase().replace(/[^.0-9a-zA-Z\u4e00-\u9fff]+/g, ' ');
    characters.push(...Array.from(cleaned));
  }

  return characters;
}

function buildStaticDataContext(tokensData, ysddData, chinglishRaw) {
  const tokenSet = new Set(tokensData);
  const ysddSource = new Map();
  const ysddDict = new Map();
  const ysddLastWordLengthIndex = new Map();

  if (typeof ysddData === 'object' && ysddData !== null) {
    Object.entries(ysddData).forEach(([filename, phrases]) => {
      if (!Array.isArray(phrases)) return;

      phrases.forEach((phrase) => {
        const fullChars = jsPinyin.getFullChars(phrase);
        ysddDict.set(fullChars, filename);

        const normalPinyin = pinyinLib(phrase, { style: 'normal' }).map((value) => value[0]);
        ysddSource.set(normalPinyin.join(''), filename);

        const lastWord = normalPinyin[normalPinyin.length - 1];
        if (!ysddLastWordLengthIndex.has(lastWord)) {
          ysddLastWordLengthIndex.set(lastWord, new Map());
        }
        if (!ysddLastWordLengthIndex.get(lastWord).has(normalPinyin.length)) {
          ysddLastWordLengthIndex.get(lastWord).set(normalPinyin.length, []);
        }
        ysddLastWordLengthIndex.get(lastWord).get(normalPinyin.length).push(normalPinyin);
      });
    });
  }

  const tonedChinglish = new Map();
  Object.entries(chinglishRaw).forEach(([char, pinyinStr]) => {
    const pinyins = pinyinStr.match(/[A-Z][a-z]*/g) || [pinyinStr];
    tonedChinglish.set(
      char.toUpperCase(),
      pinyins.map((p) => ({ p: p.toLowerCase(), t: null, isYsdd: false }))
    );
  });

  return {
    tokenSet,
    ysddSource,
    ysddDict,
    ysddLastWordLengthIndex,
    tonedChinglish
  };
}

function ysddParse(tonedPinyins, isYsddFlag, ysddLastWordLengthIndex) {
  if (!isYsddFlag || tonedPinyins.length === 0) {
    return tonedPinyins;
  }

  const optMatch = [];
  const optMatchCount = [];

  function setOptMatch(fromIndex, matchCount, tonedPinyin, ysddKey) {
    const toIndex = fromIndex + matchCount + !matchCount;
    if (!optMatch[fromIndex]) {
      optMatch[toIndex] = [{
        p: tonedPinyin?.p || ysddKey,
        t: tonedPinyin?.t || null,
        isYsdd: !!ysddKey,
        isEnglishWord: tonedPinyin?.isEnglishWord || false
      }];
      optMatchCount[toIndex] = matchCount;
      return;
    }

    const optNew = [];
    optNew.push(...optMatch[fromIndex]);
    const countNew = optMatchCount[fromIndex] + matchCount;

    if (matchCount) {
      optNew.push({ p: ysddKey, t: null, isYsdd: true });
    } else {
      optNew.push({
        p: tonedPinyin.p,
        t: tonedPinyin.t,
        isYsdd: false,
        isEnglishWord: tonedPinyin.isEnglishWord || false
      });
    }

    optMatch[toIndex] = optNew;
    optMatchCount[toIndex] = countNew;
  }

  for (let i = 0; i < tonedPinyins.length; i += 1) {
    const lastWord = tonedPinyins[i];
    const lastWordYsdd = ysddLastWordLengthIndex.get(lastWord.p);
    const optionalMatches = [];

    if (lastWordYsdd) {
      for (const length of lastWordYsdd.keys()) {
        for (const woTonePinyins of lastWordYsdd.get(length)) {
          let isEqual = true;
          for (let j = 0; j < length - 1; j += 1) {
            if (woTonePinyins[j] === tonedPinyins[i - length + j + 1]?.p) continue;
            isEqual = false;
            break;
          }
          if (!isEqual) continue;
          optionalMatches.push({ length, woTonePinyins });
        }
      }
    }

    optionalMatches.sort((a, b) => a.length - b.length);
    let selectMatchLength = optMatchCount[i - 1] || 0;
    let selectMatch = null;

    for (const { length, woTonePinyins } of optionalMatches) {
      if ((optMatchCount[i - length] || 0) + length < selectMatchLength) continue;
      selectMatchLength = (optMatchCount[i - length] || 0) + length;
      selectMatch = woTonePinyins;
    }

    if (!selectMatch) {
      setOptMatch(i - 1, 0, lastWord, null);
    } else {
      setOptMatch(i - selectMatch.length, selectMatch.length, null, selectMatch.join(''));
    }
  }

  return optMatch.pop();
}

function textToAudioSequence(text, staticData, options = {}) {
  const {
    isYsdd = false,
    isSliced = false
  } = options;

  const cleaned = cleanText(text);
  if (!cleaned) return [];

  const characters = segmentText(cleaned);

  const tonedPinyins = characters.map((value) => {
    if (value.length > 1 && /^[A-Z]+$/i.test(value)) {
      return { p: value, t: null, isEnglishWord: true };
    }

    const result = pinyinLib(value, { style: 'tone2' });
    if (result && result[0] && result[0][0]) {
      const [, p, t] = (result[0][0].match(/^([a-z]+)([0-9]?)$/) || [null, value, null]);
      return { p, t: { [null]: null, '': 0, 1: 1, 2: 2, 3: 3, 4: 4 }[t] };
    }

    return { p: value, t: null };
  });

  const ysdded = ysddParse(tonedPinyins, isYsdd, staticData.ysddLastWordLengthIndex);

  const chinglishfied = ysdded.reduce((prev, value) => {
    if (value.isEnglishWord) {
      if (isYsdd) {
        const lowerWord = value.p.toLowerCase();
        if (staticData.ysddSource.has(lowerWord) || staticData.ysddDict.has(lowerWord)) {
          prev.push({ p: lowerWord, t: null, isYsdd: true });
          return prev;
        }
      }

      for (const ch of value.p) {
        const mapped = staticData.tonedChinglish.get(ch);
        if (mapped) {
          prev.push(...mapped);
        } else {
          prev.push({ p: ch.toLowerCase(), t: null, isYsdd: false });
        }
      }
      return prev;
    }

    if (!value.p.match(/^[.A-Za-z0-9!？；：、...，。(){}_=+\-*/\\|~@#$%^&'"<>]$/)) {
      prev.push(value);
      return prev;
    }

    prev.push(...(staticData.tonedChinglish.get(getChinglishKey(value.p)) || [{ p: '_', t: null }]));
    return prev;
  }, []);

  return chinglishfied.reduce((prev, { p, isYsdd: tokenIsYsdd }) => {
    if (tokenIsYsdd) {
      let filename = staticData.ysddSource.get(p);
      if (!filename && staticData.ysddDict.has(p)) {
        filename = staticData.ysddDict.get(p);
      }

      if (filename) {
        prev.push(`<${filename}>`);
      } else if (staticData.tokenSet.has(p)) {
        prev.push(p);
      } else if (prev[prev.length - 1] !== '_') {
        prev.push('_');
      }
    } else if (staticData.tokenSet.has(p)) {
      prev.push(p);
    } else if (prev[prev.length - 1] !== '_') {
      prev.push('_');
    }

    if (isSliced) prev.push('_');
    return prev;
  }, []);
}

module.exports = {
  buildStaticDataContext,
  textToAudioSequence
};
