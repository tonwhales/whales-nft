import * as fs from 'fs'
import * as pathUtils from 'path'
import { parse } from 'yaml'
import Prando from 'prando'
import mergeImages from 'merge-images'
import { appendFile, writeFile } from 'fs/promises'
import { Image, Canvas } from 'canvas'

// @ts-ignore
import ImageDataURI from 'image-data-uri'

type Optional<T> = { [K in keyof T]?: T[K]  }

type LayerConfig = {
    rarity: number
    cannot_be_with: string[]
}

type Layer = {
    path: string,
    overrides?: { [key: string]: number | Optional<LayerConfig> },
} & LayerConfig

type Config = {
    root: string,
    output: string,
    seed: string,
    count: number,
    layers: Layer[]
}

const config: Config = parse(fs.readFileSync('./config.yaml', { encoding: 'utf-8' }))

const random = new Prando(config.seed);

function loadConstraints(layers: Layer[]) {
    let constraints = new Map<string, string[]>();

    let addConstraint = (name: string, cannotBeWith: string) => {
        let prevConstraints = constraints.get(name) || [];
        prevConstraints.push(cannotBeWith);
        constraints.set(name, prevConstraints);
    }

    for (let layer of layers) {
        if (layer.cannot_be_with) {
            for (let unsuitable of layer.cannot_be_with) {
                addConstraint(layer.path, unsuitable);
                addConstraint(unsuitable, layer.path);
            }
        }
    }

    return constraints;
}


type ImageTrait = {
    type: 'image',
    name: string,
    layer: string,
};
type EmptyTrait = { type: 'empty' };
type Trait = ImageTrait | EmptyTrait;

function loadTraits(layer: Layer) {
    const traitsDir = pathUtils.resolve(config.root, layer.path);
    let traitsFiles = fs.readdirSync(traitsDir);

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
    return weightedTraits;
}

async function main() {
    const constraintsMap = loadConstraints(config.layers);
    console.log(constraintsMap);
    const layers = config.layers.map(layer => ({ traits: loadTraits(layer), layer }));
    let used = new Set<string[]>();
    let nfts: string[][] = [];
    for (let i = 0; i < config.count; i++) {
        let combination: string[] = [];
        do {
            combination = [];
            let constraints: string[] = [];
            for (let layer of layers) {
                if (constraints.includes(layer.layer.path)) {
                    combination.push('empty');
                    continue;
                }
                let selected = random.nextArrayItem(layer.traits);
                combination.push(selected.type === 'image' ? selected.name : 'empty');
                if (selected.type == 'image') {
                    constraints.push(...(constraintsMap.get(layer.layer.path) || []))
                }
            }
        } while (used.has(combination));
        used.add(combination);
        nfts.push(combination);
    }

    let i = 0;
    const previewPath = pathUtils.resolve(config.output, 'preview.html');
    await writeFile(previewPath, '<head><style>img { width: 80px; height: 80px; margin: 8px }</style></head>');
    for (let nft of nfts.slice(0, 1000)) {
        let images: string[] = [];
        for (let i = 0; i < nft.length; i++) {
            if (nft[i] === 'empty') {
                continue;
            }
            images.push(pathUtils.resolve(config.root, config.layers[i].path, nft[i] + '.png'));
        }
        let image = await mergeImages(images, { Canvas, Image });
        await ImageDataURI.outputFile(image, pathUtils.resolve(config.output, i + '.png'));
        
        await appendFile(previewPath, `<img alt="${nft.join(' ')}" src="${i + '.png'}"></img>`)
        i++;
    }
}
main();