import * as fs from 'fs'
import * as pathUtils from 'path'
import { parse } from 'yaml'
import Prando from 'prando'
import mergeImages from 'merge-images'
import { appendFile, writeFile, readdir, mkdir, copyFile, readFile } from 'fs/promises'
import canvas from 'canvas'
import ora from 'ora'

const { Image, Canvas } = canvas;

// @ts-ignore
import ImageDataURI from 'image-data-uri'

type Optional<T> = { [K in keyof T]?: T[K]  }

type LayerConfig = {
    rarity: number
    cannot_be_with?: string[]
}

type Overrides = { [key: string]: number | Optional<LayerConfig> }

type Layer = {
    path: string,
    name: string,
    overrides?: Overrides,
} & LayerConfig


type CustomConfig = {
    name: string
    count: number
    path: string
    uses?: string[]
    layers?: Layer[]
    special: boolean
} & { special: true, overrides?: { [skin: string]: { [key: string]: number } } }

type Config = {
    root: string,
    output: string,
    seed: string,
    count: number,
    layers: Layer[]
    logo?: string
    name_aliases?: string
    perks?: { [key: string]: { path: string, layer: string, levels: { name: string, count: number }[], distribution: { special: number, others: number } } }
    custom?: CustomConfig[]
}

const config: Config = parse(fs.readFileSync('./config.yaml', { encoding: 'utf-8' }))

const random = new Prando(config.seed);

function shuffle<T>(array: T[]) {
    let remaining = array.length - 1;
    while (remaining > 0) {
        let idx = Math.floor(random.next(0, remaining));

        if (array[remaining] == undefined) {
            console.log(remaining);
        }

        [array[remaining], array[idx]] = [array[idx], array[remaining]];
        remaining--;
    }
}

const Constraints = new Map<string, string[]>();

function addConstraint(name: string, cannotBeWith: string) {
    let prevConstraints = Constraints.get(name) || [];
    prevConstraints.push(cannotBeWith);
    Constraints.set(name, prevConstraints);
}

function loadConstraints(layers: Layer[]) {
    for (let layer of layers) {
        if (layer.cannot_be_with) {
            for (let unsuitable of layer.cannot_be_with) {
                addConstraint(layer.path, unsuitable);
                addConstraint(unsuitable, layer.path);
            }
        }
        if (layer.overrides) {
            for (let [traitName, override] of Object.entries(layer.overrides)) {
                if (typeof override !== 'number' && override.cannot_be_with) {
                    for (let unsuitable of override.cannot_be_with) {
                        addConstraint(`${layer.path}/${traitName}`, unsuitable);
                        addConstraint(unsuitable, `${layer.path}/${traitName}`);
                    }
                }
            }
        }
    }
}


type ImageTrait = {
    type: 'image',
    name: string,
    layer: string,
};
type EmptyTrait = { type: 'empty' };
type Trait = ImageTrait | EmptyTrait;

async function loadTraits(layer: Layer) {
    const traitsDir = pathUtils.resolve(config.root, layer.path);
    let traitsFiles: string[] = [];
    try {
        traitsFiles = await readdir(traitsDir);
    } catch {
        // console.warn('[warn] cannot find traits for ' + traitsDir);
    }
    

    let baseTraits: ImageTrait[] = [];
    for (let file of traitsFiles) {
        baseTraits.push({
            type: 'image',
            layer: layer.path,
            name: pathUtils.basename(file, '.png')
        })
    }
    let raritiesMap = new Map<string, number>();
    raritiesMap.set('default', layer.rarity);
    if (layer.overrides) {
        for (let [path, override] of Object.entries(layer.overrides)) {
            if (typeof override === 'number') {
                raritiesMap.set(path, layer.rarity * override);
            } else {
                if (override.rarity) {
                    raritiesMap.set(path, layer.rarity * override.rarity);
                }
            }
        }
    }

    let weightedTraits: Trait[] = [];
    for (let trait of baseTraits) {
        let count = (raritiesMap.get(trait.name) || raritiesMap.get('default')!) * 100;
        for (let i = 0; i < count; i++) {
            weightedTraits.push(trait);
        }
    }
    if (layer.rarity < 1) {
        let emptyCount = Math.round((1 - layer.rarity) / layer.rarity * weightedTraits.length);
        for (let i = 0; i < emptyCount; i++) {
            weightedTraits.push({ type: 'empty' });
        }
    }
    if (weightedTraits.length === 0) {
        weightedTraits.push({ type: 'empty' });
    }
    return { weightedTraits, count: traitsFiles.length };
}


type Tier = { layers: { traits: Trait[], layer: Layer }[], count: number, special: boolean };
async function loadTiers() {
    let result = new Map<string, Tier>(); 
    if (!config.custom) {
        return result;
    }
    for (let custom of config.custom) {
        if (custom.special) {
            let specialPaths = await readdir(pathUtils.resolve(config.root, custom.path));
            let total = 0;
            for (let specialPath of specialPaths) {
                let name = pathUtils.basename(specialPath);
                let layers: { traits: Trait[], layer: Layer }[] = [];
                let variants = 1;
                for (let layer of config.layers) {
                    let newLayer = {
                        path: pathUtils.join(custom.path, name, layer.path),
                        rarity: custom.overrides?.[name]?.[layer.path] || layer.rarity,
                        name: layer.name,
                    };
                    let traits = await loadTraits(newLayer);
                    layers.push({
                        layer: newLayer,
                        traits: traits.weightedTraits,
                    });
                    variants = variants * Math.max(traits.count, 1);
                }
                let count = Math.min(Math.floor(custom.count / specialPaths.length), variants);
                result.set(name, { 
                    layers,
                    count,
                    special: custom.special
                });
                total += count;
            }
            if (total < custom.count) {
                while (total !== custom.count) {
                    let name = pathUtils.basename(random.nextArrayItem(specialPaths));
                    let tier = result.get(name)!;
                    if (tier.count < 55) {
                        continue;
                    }
                    tier.count++;
                    total++;
                }
            }
            continue;
        }
        let layers: { traits: Trait[], layer: Layer }[] = [];
        for (let layer of config.layers) {
            if (custom.uses?.includes(layer.path)) {
                layers.push({
                    layer,
                    traits: (await loadTraits(layer)).weightedTraits
                })
            } else {
                let newLayer = {
                    path: pathUtils.join(custom.path, layer.path),
                    rarity: layer.rarity,
                    name: layer.name
                };
                layers.push({
                    layer: newLayer,
                    traits: (await loadTraits(newLayer)).weightedTraits
                })
            }
        }
        if (custom.layers) {
            for (let layer of custom.layers) {
                let newLayer = {
                    path: pathUtils.join(custom.path, layer.path),
                    rarity: layer.rarity,
                    name: layer.name
                };
                layers.push({
                    layer: newLayer,
                    traits: (await loadTraits(newLayer)).weightedTraits
                })
            }
        }

        result.set(custom.name, { layers, count: custom.count, special: custom.special });
    }
    return result;
} 

type Perk = {
    name: string
    level: string
    layer: string
    path: string
}
function randomizeTiersAndPerks(tiers: Map<string, Tier>) {
    let remaining = config.count;
    let result: { tier: string, perks: Perk[] }[] = [];
    let specials: { tier: string, perks: Perk[] }[] = [];
    for (let [name, tier] of tiers) {
        for (let i = 0; i < tier.count; i++) {
            remaining--;
            if (tier.special) {
                specials.push({ tier: name, perks: [] });
            } else {
                result.push({ tier: name, perks: [] });
            }
        }
    }
    for (; remaining > 0; remaining--) result.push({ tier: 'Common', perks: [] });

    shuffle(result);
    shuffle(specials);

    if (config.perks) {
        for (let [name, perk] of Object.entries(config.perks)) {
            let slots: Perk[] = [];
            for (let l of perk.levels) {
                for (let i = 0; i < l.count; i++) slots.push({ level: l.name, name, layer: perk.layer, path: perk.path });
            }
            shuffle(slots);

            for (let i = 0; i < perk.distribution.special; i++) {
                specials[i].perks.push(slots.pop()!);
            }
            for (let i = 0; i < perk.distribution.others; i++) {
                result[i].perks.push(slots.pop()!);
            }
        }
    }
    result = result.concat(specials);

    shuffle(result);
    return result;
}

async function loadTraitAliases() {
    let result = new Map<string, string>();
    if (!config.name_aliases) {
        return result;
    }
    let data = await readFile(pathUtils.resolve(config.root, config.name_aliases), { encoding: 'utf-8' });
    return new Map<string, string>(data.split('\n').map<[string, string]>(a => a.split(',') as [string, string]));
}

async function main() {
    let spinner = ora();
    spinner.start('Loading traits');

    loadConstraints(config.layers);
    const commonLayers = await Promise.all(config.layers.map(async layer => ({ traits: (await loadTraits(layer)).weightedTraits, layer })));
    const tiers = await loadTiers();
    const traitAliases = await loadTraitAliases();

    spinner.text = 'Building nfts';

    let used = new Set<string>();
    let nfts: string[][] = [];
    let nftAttributes: { [key: string]: string }[] = [];
    for (let { tier, perks } of randomizeTiersAndPerks(tiers)) {
        let layers = commonLayers;
        if (tier !== 'Common') {
            layers = tiers.get(tier)!.layers;
        }


        let combination: string[] = [];
        let attributes: { [key: string]: string };
        let attempts = 0;
        do {
            combination = [];
            attributes = {};
            attributes['Tier'] = tier;
            let constraints: string[] = [];
            for (let layer of layers) {
                let isPerk = false;
                for (let perk of perks) {
                    if (layer.layer.path.endsWith(perk.layer)) {
                        attributes[perk.name] = perk.level;
                        attributes[layer.layer.name] = perk.name.toLowerCase();
                        combination.push(perk.path);
                        isPerk = true;
                    }
                }
                if (isPerk) {
                    continue;
                }
                if (constraints.includes(layer.layer.path)) {
                    combination.push('empty');
                    if (!attributes[layer.layer.name]) {
                        attributes[layer.layer.name] = 'none';
                    }
                    continue;
                }
                let selected: Trait;
                while (true) {
                    if (tier === 'Miner' && layer.layer.path.endsWith('9-hand')) {
                        let backIdx = layers.findIndex(a => a.layer.path.endsWith('3-body_back'));
                        let selectedBack = combination[backIdx];
                        selected = layer.traits.find(a => a.type === 'image' && a.name === 'hand_' + selectedBack.split('/').pop())!;
                        break;
                    }
                    selected = random.nextArrayItem(layer.traits);
                    if (selected.type === 'image' && constraints.includes(layer.layer.path + '/' + selected.name)) {
                        continue;
                    }
                    break;
                }
                combination.push(selected.type === 'image' ? (layer.layer.path + '/' + selected.name) : 'empty');
                if (!attributes[layer.layer.name]) {
                    if (selected.type === 'image') {
                        attributes[layer.layer.name] = traitAliases.get(layer.layer.path + '/' + selected.name + '.png') || selected.name
                    } else {
                        attributes[layer.layer.name] = 'none';
                    }
                    
                }
                if (selected.type == 'image') {
                    constraints.push(...(Constraints.get(layer.layer.path) || []))
                }
            }
            attempts++;
            if (attempts == 100) {
                console.log(combination);
                throw new Error('Cannot build unique combination');
            }            
        } while (used.has(combination.join('/')));
        used.add(combination.join('/'));
        nfts.push(combination);
        nftAttributes.push(attributes);
    }
    spinner.succeed(`Built ${nfts.length} nfts`);


    spinner.start('Doing some magic');
    let total = 1000;
    await mkdir(config.output, { recursive: true });
    const previewPath = pathUtils.resolve(config.output, 'preview.html');
    await writeFile(previewPath, '<head><style>img { width: 80px; height: 80px; margin: 8px }</style></head>');
    await writeFile(pathUtils.resolve(config.output,  'attributes.jsonl'), '');
    if (config.logo) {
        await copyFile(pathUtils.resolve(config.root, config.logo), pathUtils.resolve(config.output, 'logo.png'));
    }
    for (let idx = 0; idx < total; idx++) {
        let nft = nfts[idx];
        let attributes = nftAttributes[idx];
        let images: string[] = [];
        for (let i = 0; i < nft.length; i++) {
            if (nft[i] === 'empty') {
                continue;
            }
            images.push(pathUtils.resolve(config.root, nft[i] + '.png'));
        }
        try {
            let image = await mergeImages(images, { Canvas, Image });
            await ImageDataURI.outputFile(image, pathUtils.resolve(config.output, idx + '.png'));

            await writeFile(pathUtils.resolve(config.output, idx + '.json'), JSON.stringify(attributes));
            await appendFile(pathUtils.resolve(config.output, 'attributes.jsonl'), JSON.stringify(attributes) + '\n');
        
            await appendFile(previewPath, `<img alt="${nft.join(' ')}" src="${idx + '.png'}"></img>`)
            spinner.prefixText = `${idx.toString()}/${total}`;
        } catch {
            console.log(images);
        }
    }
    spinner.succeed();
}
main().catch(e => console.error(e));