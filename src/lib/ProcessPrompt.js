import axios from 'axios';
import { datasets } from '@/lib/NAI';
import { extractList, removeArray } from '@/lib/utils';

let previousSearchTags = null;
let positions = null;
let wildcards = [];

export async function processPrompt(config, onProgress) {
    // migrate favorite to wildcard
    if (localStorage.getItem('favorite') != null) {
        localStorage.setItem('__FAVORITE__', localStorage.getItem('favorite').split(',').join('\n'));
        localStorage.removeItem('favorite');
    }

    let prompt = new Prompt(config.prompt_beg, config.prompt_search, config.prompt_end, config.negative);

    prompt.formatPrompt(config);
    prompt.processDynamicPrompt();
    prompt.processWildcard();
    prompt.processDynamicPrompt();

    prompt.tokenizePrompt();
    if (config.search_disabled) {
        prompt.randomPrompt = new Tokenizer("");
    }
    else {
        await prompt.getRandomPrompt(onProgress);
        prompt.processRandomPrompt(config);
    }
    
    prompt.processPrompt();
    await prompt.strengthenCharacter(config);

    let result = new Tokenizer();

    result.concat(prompt.beg);
    result.concat(prompt.randomPrompt);
    result.concat(prompt.end);
    
    result.removeDuplicates();

    if (config.reorder) {
        result.reorder();
    }
    if (config.naistandard) {
        result.naistandard();
    }

    return result.toString();
}

export async function processCharacterPrompts(config) {
    let characterPrompts = JSON.parse(JSON.stringify(config.character_prompts));

    for (let i = 0; i < characterPrompts.length; i++) {
        characterPrompts[i].prompt = await processCharacterPrompt(characterPrompts[i], config);
    }

    return characterPrompts;
}

async function processCharacterPrompt(data, config) {
    let prompt = data.prompt;
    prompt = formatPrompt(prompt);
    prompt = processDynamicPrompt(prompt);
    prompt = processWildcard(prompt);
    prompt = new Tokenizer(prompt);
    
    let characterData = await processCharacterData(prompt.toArray(), [], []);
    let strengthPrompt = await strengthenCharacter(config, characterData);
    for (let tag of strengthPrompt) {
        prompt.add(tag, 0);
    }

    prompt.removeDuplicates();

    if (config.reorder) {
        prompt.reorder();
    }
    if (config.naistandard) {
        prompt.naistandard();
    }

    return prompt.toString();
}

class Prompt {
    constructor(beg, search, end, negative) {
        this.beg = beg;
        this.search = search;
        this.end = end;
        this.negative = negative;
        this.randomPrompt = null;
    }

    formatPrompt(config) {
        // Process Search Prompt
        if (config.remove_nsfw && this.search.trim() != "") {
            this.search += ', rating:g';
        }

        this.beg = formatPrompt(this.beg);
        this.search = formatPrompt(this.search);
        this.end = formatPrompt(this.end);
        this.negative = formatPrompt(this.negative);


        this.search = this.search.replaceAll('rating:general', 'rating:g');
        this.search = this.search.replaceAll('rating:questionable', 'rating:q');
        this.search = this.search.replaceAll('rating:explicit', 'rating:e');
        this.search = this.search.replaceAll('rating:sensitive', 'rating:s');
        this.search = this.search.replaceAll('rating: general', 'rating:g');
        this.search = this.search.replaceAll('rating: questionable', 'rating:q');
        this.search = this.search.replaceAll('rating: explicit', 'rating:e');
        this.search = this.search.replaceAll('rating: sensitive', 'rating:s');
    }

    processDynamicPrompt() {
        this.beg = processDynamicPrompt(this.beg);
        this.search = processDynamicPrompt(this.search);
        this.end = processDynamicPrompt(this.end);
        this.negative = processDynamicPrompt(this.negative);
    }

    processWildcard() {
        this.beg = processWildcard(this.beg);
        this.search = processWildcard(this.search);
        this.end = processWildcard(this.end);
    }

    tokenizePrompt() {
        this.beg = new Tokenizer(this.beg);
        this.search = new Tokenizer(this.search);
        this.end = new Tokenizer(this.end);
        this.negative = new Tokenizer(this.negative);
    }

    async getRandomPrompt(onProgress) {
        this.randomPrompt = await getRandomPrompt(this.search, onProgress)
        this.randomPrompt = this.randomPrompt.replaceAll('rating:g', 'rating:general');
        this.randomPrompt = this.randomPrompt.replaceAll('rating:q', 'rating:questionable');
        this.randomPrompt = this.randomPrompt.replaceAll('rating:e', 'rating:explicit');
        this.randomPrompt = this.randomPrompt.replaceAll('rating:s', 'rating:sensitive');

        this.randomPrompt = new Tokenizer(this.randomPrompt);
    }

    processPrompt() {
        // Strong Uncensorship
        let uncensored = this.beg.includes('uncensored') || this.end.includes('uncensored');
        
        if (uncensored) {
            this.randomPrompt.remove(datasets.censor);
        }
    }

    processRandomPrompt(config) {
        // keep only whitelist
        this.randomPrompt.keepWhitelist();

        if (config.remove_artist) {
            this.randomPrompt.remove(datasets.artist);
        }
        if (config.remove_character) {
            this.randomPrompt.remove(datasets.character);
        }
        if (config.remove_characteristic) {
            this.randomPrompt.remove(datasets.characteristic);
        }
        if (config.remove_attire) {
            this.randomPrompt.remove(datasets.clothes);
        }
        if (config.remove_copyright) {
            this.randomPrompt.remove(datasets.copyright);
        }
        if (config.remove_ornament) {
            this.randomPrompt.remove(datasets.ornament);
        }
        if (config.remove_emotion) {
            this.randomPrompt.remove(datasets.emotions);
        }
        
        this.randomPrompt.remove(['rating:general', 'rating:questionable', 'rating:explicit', 'rating:sensitive']);

        // Remove bad tags
        this.randomPrompt.remove(datasets.bad);

        // Remove duplicates
        this.randomPrompt.remove(this.beg);
        this.randomPrompt.remove(this.end);
        this.randomPrompt.remove(this.negative);
    }

    async strengthenCharacter(config) {
        let characterData = await processCharacterData(this.beg.toArray(), this.randomPrompt.toArray(), this.end.toArray());
        let strengthPrompt = await strengthenCharacter(config, characterData);

        for (let tag of strengthPrompt) {
            this.end.prepend(tag, 0);
        }

        let res = await removeClothesActions(this.randomPrompt.toArray(), characterData, this.beg.toArray(), this.end.toArray());
        this.randomPrompt = new Tokenizer(res.join(','));
    }

    print() {
        //console.clear();
        console.log("Beginning Prompt");
        console.log(this.beg);
        console.log("\n");
        console.log("Search Prompt");
        console.log(this.search);
        console.log("\n");
        console.log("End Prompt");
        console.log(this.end);
        console.log("\n");
        console.log("Negative Prompt");
        console.log(this.negative);
        console.log("\n");
        console.log("Random Prompt");
        console.log(this.randomPrompt);
    }
}

async function strengthenCharacter(config, characterData) {
    let prompts = [];

    // Add copyright
    if (config.auto_copyright) {
        for (let data of characterData) {
            for (let copyright of data.copyright) {
                if (datasets.copyright.includes(copyright[0])) {
                    prompts.push(copyright[0]);
                }
            }
        }
    }

    let characterStrength = ((1 - config.DEV_CHARACTER_STRENGTH) * 0.8 + 0.2).toFixed(2);
    console.log("CHARACTER STRENGTH: " + characterStrength);

    // Strengthen Characteristics
    if (config.strengthen_characteristic) {
        for (let data of characterData) {
            for (let tag of data.tags) {
                if (datasets.characteristic.includes(tag[0])) {
                    if (tag[1] >= characterStrength)
                        prompts.push(tag[0]);
                }
            }
        }
    }

    // Strengthen Attire
    if (config.strengthen_attire) {
        for (let data of characterData) {
            for (let tag of data.tags) {
                if (datasets.clothes.includes(tag[0])) {
                    if (tag[1] >= characterStrength)
                        if (!tag[0].includes("panties") && !tag[0].includes("bra") && !tag[0].includes("panty") && !tag[0].includes("underwear"))
                            prompts.push(tag[0]);
                }
            }
        }
    }

    // Strengthen Ornament
    if (config.strengthen_ornament) {
        for (let data of characterData) {
            for (let tag of data.tags) {
                if (datasets.ornament.includes(tag[0])) {
                    if (tag[1] >= characterStrength)
                        prompts.push(tag[0]);
                }
            }
        }
    }

    return prompts;
}

class Token {
    constructor(str, strength) {
        this.str = str;
        this.strength = strength;
    }
}

class Tokenizer {
    #tokens;

    constructor(str) {
        this.#tokens = [];
        if (str != undefined)
            this.tokenize(str);

        this.#tokens = this.#tokens.filter((el) => {
            return el.str.trim() != "";
        });
    }

    add(str, strength) {
        this.#tokens.push(new Token(str, strength));
    }

    prepend(str, strength) {
        this.#tokens.unshift(new Token(str, strength));
    }

    get(i) {
        return this.#tokens[i];
    }

    getTokens() {
        return this.#tokens;
    }

    set(i, str) {
        this.#tokens[i].str = str;
    }

    size() {
        return this.#tokens.length;
    }

    keepWhitelist() {
        this.#tokens = this.#tokens.filter((el) => {
            return datasets.whitelist.find((t) => {
                return t[0] == el.str.trim();
            });
        });
    }

    toString() {
        let strength = 0;
        let str = "";

        for(let i = 0; i < this.size(); i++) {
            let token = this.#tokens[i];

            if (token.strength != strength) {
                str = str.substring(0, str.length - 2);

                if (token.strength > strength) {
                    for(let j = strength; j < token.strength; j++) {
                        if (j < 0) {
                            str += "]";
                            if (j == token.strength - 1 && i != this.size() - 1) str += ', ';
                        }
                        else {
                            if (str.at(-1) != '{') str += ', ';
                            str += "{";
                        }
                    }
               }
                else if (token.strength < strength) {
                    for(let j = strength; j > token.strength; j--) {
                        if (j <= 0) {
                            if (str.at(-1) != '[') str += ', ';
                            str += "[";
                        }
                        else {
                            str += "}";
                            if (j == token.strength + 1 && i != this.size() - 1) str += ', ';
                        }
                    }
                }

                strength = token.strength;
            }
            str += token.str;
            if (i < this.size() - 1) str += ', ';
        }

        return str;
    }

    toArray() {
        let arr = [];
        for (let i = 0; i < this.#tokens.length; i++) {
            arr.push(this.#tokens[i].str);
        }

        return arr;
    }

    removeDuplicates() {
        this.#tokens = this.#tokens.filter((el, index, self) =>
            index === self.findIndex((t) => (
                t.str === el.str
            ))
        );
    }

    includes(str) {
        for (let i = 0; i < this.#tokens.length; i++) {
            if (this.#tokens[i].str == str) {
                return true;
            }
        }

        return false;
    }

    reorder() {
        let result = new Tokenizer();
        result.concat(this.extract(datasets.count, true));
        result.concat(this.extract(datasets.character, true));
        result.concat(this.extract(datasets.copyright, true));
        result.concat(this.extract(datasets.artist, true, "artist:"));
        let quality = this.extract(datasets.quality, true);
        result.concat(this);
        result.concat(quality);

        this.#tokens = result.getTokens();
    }

    naistandard() {
        const replace = {
            'v': 'peace sign',
            'double v': 'double peace',
            '| |': 'bar eyes',
            '\| |/': 'open \m/',
            ':|': 'neutral face',
            ';|': 'neutral face',
            'eyepatch bikini': 'square bikini',
            'tachi-e': 'character image' 
        }

        for (let i = 0; i < this.size(); i++) {
            if (replace.hasOwnProperty(this.get(i).str)) {
                this.set(i, replace[this.get(i).str]);
            }
            else if (datasets.artist.includes(this.get(i).str)) {
                this.set(i, 'artist:' + this.get(i).str);
            }
        }
    }

    remove(list) {
        if (list instanceof Tokenizer) {
            let temp = [];
            for (let i = 0; i < list.size(); i++) {
                temp.push(list.get(i).str);
            }
            list = temp;
        }

        for (let i = 0; i < list.length; i++) {
            for (let j = 0; j < this.#tokens.length; j++) {
                if (this.#tokens[j].str == list[i]) {
                    this.#tokens.splice(j, 1);
                    break;
                }
            }
        }
    }

    concat(other) {
        this.#tokens = this.#tokens.concat(other.getTokens());
    }

    extract(list, removeExtracted=false, prefix="") {
        let temp = new Tokenizer();

        for(let item of list) {
            for (let i = 0; i < this.size(); i++) {
                let str = this.get(i).str.replace(prefix, '');
                if (str == item) {
                    temp.add(this.get(i).str, this.get(i).strength);
                    if (removeExtracted) {
                        this.#tokens.splice(i, 1);
                        i--;
                    }
                }
            }
        }

        return temp;
    }

    tokenize(str) {
        let strength = 0;
        let buffer = "";
        let bufferStrength = 0;

        for (let i = 0; i < str.length; i++) {
            if (str[i] == '{' || str[i] == ']') {
                strength++;
            }
            else if (str[i] == '}' || str[i] == '[') {
                strength--;
            }
            else if (str[i] == ',') {
                this.add(buffer, bufferStrength);
                buffer = "";
                bufferStrength = 0;
            }
            else {
                buffer += str[i];
                bufferStrength = strength;
            }
        }
    }
}

function processWildcard(prompt) {
    let matches = prompt.matchAll(/__.*?__/g);
    for (const match of matches) {
        let wc = match[0];
        if (localStorage.getItem(wc) != null) {
            let data = localStorage.getItem(wc).split('\n');
            data = data.filter((el) => {
                return el.trim() != "";
            });

            let selected = data[Math.floor(Math.random() * data.length)];
            prompt = prompt.substring(0, match.index) + selected + prompt.substring(match.index + wc.length);
        }
    }

    return prompt;
}

function formatPrompt(prompt) {
    // 1. 엔터를 쉼표로 바꾸던 개짓거리(replaceAll) 삭제
    // 2. trim()으로 공백 지우던 로직 삭제
    
    let arr = [];
    let buffer = "";
    
    for (let i = 0; i < prompt.length; i++) {
        // 특수문자 기준으로 쪼개는 건 유지하되, 공백은 건드리지 않음
        const specialChars = [',', '{', '}', '[', ']', '|', '<', '>', '~'];
        
        if (specialChars.includes(prompt[i])) {
            arr.push(buffer); // 여기서 .trim()을 빼버려야 공백이 살아남음
            arr.push(prompt[i]);
            buffer = "";
        }
        else {
            buffer += prompt[i];
        }
    }
    
    if (buffer) arr.push(buffer);

    // 빈 문자열만 걸러내고 그대로 합침
    return arr.filter(el => el !== "").join('');
}


function processDynamicPrompt(prompt) {
    let bcount = 0;
    let buffer = "";
    let data = [];

    let start = 0;

    for (let i = 0; i < prompt.length; i++) {
        if (prompt[i] == '<') {
            bcount++;
            if (bcount == 1) {
                start = i;
                buffer = "";
                continue;
            }
        }
        else if (prompt[i] == '>') {
            bcount--;
            if (bcount == 0) {
                data.push(buffer);
                buffer = "";

                let selected = data[Math.floor(Math.random() * data.length)];
                prompt = prompt.substring(0, start) + selected + prompt.substring(i+1);
                i = start - 1;
                data = [];
                continue;
            }
        }
        else if (prompt[i] == '|') {
            if (bcount == 1) {
                data.push(buffer);
                buffer = "";
                continue;
            }
        }
        
        buffer += prompt[i];
    }

    return prompt;
}


async function getRandomPrompt(searchPrompt, onProgress) {
    let search = [];

    // Get search tags
    for (let i = 0; i < searchPrompt.size(); i++) {
        search.push(searchPrompt.get(i).str);
    }

    // Process including and excluding
    let including = [];
    let excluding = [];
    for (let tags of search) {
        if(tags[0] == '~') {
            excluding.push(tags.substring(1));
        }
        else {
            including.push(tags);
        }
    }

    // Remove duplicates of including and excluding
    including = Array.from(new Set(including));
    excluding = Array.from(new Set(excluding));

    // Check if including and excluding tags are empty
    if (including.length == 0 && excluding.length == 0) {
        return "";
    }
    if (including.length == 0 && excluding.length != 0) {
        throw new Error('Cannot only exclude tags from Search Tags');
    }

    // Check including and excluding tags
    for(let i = 0; i < including.length; i++) {
        if (!datasets.key.hasOwnProperty(including[i])) {
            throw new Error(`Tag "${including[i]}" not found`);
        }
    }
    for(let i = 0; i < excluding.length; i++) {
        if (!datasets.key.hasOwnProperty(excluding[i])) {
            throw new Error(`Tag "${excluding[i]}" not found`);
        }
    }

    let str = including.join(',') + '|' + excluding.join(',');
    if (str != previousSearchTags) {
        previousSearchTags = str;
        positions = [];

        let processed = 0;
        let total = including.length + excluding.length;

        let includingPos = [];
        let excludingPos = [];

        onProgress(`Searching prompts... (0%)`);

        // Get positions of including tags
        for (let tag of including) {
            (async() => {
                let pos = await getPositionsOfTag(tag);
                if (pos == null) {
                    throw new Error(`Couldn't find tag: "${tag}"`);
                }

                includingPos.push(new Set(pos));

                onProgress(`Searching prompts... (${Math.floor((processed / total) * 100)}%)`);
                processed++;
            })();
        }

        // Remove positions of excluding tags
        for (let tag of excluding) {
            (async() => {
                let pos = await getPositionsOfTag(tag);
                if (pos == null) {
                    throw new Error(`Couldn't find tag: "${tag}"`);
                }

                excludingPos.push(new Set(pos));

                onProgress(`Searching prompts... (${Math.floor((processed / total) * 100)}%)`);
                processed++;
            })();
        }

        await new Promise((resolve, reject) => {
            const interval = setInterval(() => {
                if (processed == total) {
                    clearInterval(interval);
                    resolve();
                }
            }, 100);
        });

        // Including
        positions = includingPos[0];
        for (let i = 1; i < includingPos.length; i++) {
            positions = new Set([...positions].filter(x => includingPos[i].has(x)));
        }

        // Excluding
        for (let i = 0; i < excludingPos.length; i++) {
            positions = new Set([...positions].filter(x => !excludingPos[i].has(x)));
        }

        positions = Array.from(positions);
    }

    // Random prompt
    if (positions.length == 0) {
        throw new Error('No prompts found');
    }
    let position = positions[Math.floor(Math.random() * positions.length)];
    let result = await getPromptAt(position);

    return result;
}

async function getPromptAt(pos) {
    let res = await axios.get(`https://huggingface.co/Jio7/NAI-Prompt-Randomizer/resolve/main/tags.dat`, {
        headers: {
            Range: `bytes=${pos}-${pos + 10000}`
        },
        responseType: 'text'
    });

    let prompt = res.data.substring(0, res.data.indexOf('\n'));
    return prompt;
}

async function getPositionsOfTag(tag) {
    let range = datasets.key[tag];

    if (range == undefined) {
        return null;
    }

    let positions = [];
    let res = await axios.get(`https://huggingface.co/Jio7/NAI-Prompt-Randomizer/resolve/main/pos.dat`, {
        headers: {
            Range: `bytes=${range.start*4}-${range.end*4 - 1}`
        },
        responseType: 'arraybuffer'
    });

	let view = new DataView(res.data, 0);

	for (let i = 0; i < res.data.byteLength / 4; i++) {
		positions.push(view.getUint32(i * 4));
	}

    return positions;
}

async function processCharacterData(prompt_beg, randomPrompt, prompt_end) {
    let list = prompt_beg.concat(randomPrompt, prompt_end);
    list = list.filter((el) => {
        return el.trim() != "";
    });
    let characters = (await extractList(list, datasets.character, true))[0];
    let result = [];

    for (let character of characters) {
        let tags = await getCharacterTags(character);
        if (tags.length != 0) {
            result.push(tags);
        }
    }

    return result;
}

async function getCharacterTags(name) {
    let data = datasets.character_data_index[name];

    if (data == undefined) {
        return [];
    }

    let res = await axios.get('https://huggingface.co/Jio7/NAI-Prompt-Randomizer/resolve/main/character_data.json', {
        headers: {
            Range: `bytes=${data.start}-${data.start+data.size-2}`
        }
    });

    res = res.data;

    return res;
}

async function removeClothesActions(randomPrompt, characterData, prompt_beg, prompt_end) {
    let clothes = [];

    // girl must have panties and bra
    if (prompt_beg.includes('1girl') || randomPrompt.includes('1girl') || prompt_end.includes('1girl')) {
        clothes.push('panties');
        clothes.push('bra');
    }

    // character tags to prompt
    let characterTags = [];
    for (let data of characterData) {
        for (let tag of data.tags) {
            characterTags.push(tag[0]);
        }
    }

    // find clothes (keys)
    for (let tag of Array.from(new Set(prompt_beg.concat((await extractList(randomPrompt, datasets.clothes.concat(datasets.ornament), true))[0], prompt_end, characterTags)))) {
        for(let spl of tag.split(' ')) {
            spl = spl.trim();
            if (datasets.clothes_actions_json.hasOwnProperty(spl)) {
                clothes = clothes.concat(spl);
            }
        }
    }

    clothes = Array.from(new Set(clothes));

    // get disallowed clothes
    let disallowedClothes = [];
    for (let key of Object.keys(datasets.clothes_actions_json)) {
        if (!clothes.includes(key)) {
            disallowedClothes = disallowedClothes.concat(datasets.clothes_actions_json[key]);
        }
    }

    randomPrompt = removeArray(randomPrompt, disallowedClothes);

    return randomPrompt;
}
