import { writeFile, mkdir } from 'fs/promises';
import * as path from 'path';


const IMAGES_BASE_PATH = 'https://whales.infura-ipfs.io/ipfs/QmaJAXD6xoMT2Marz7MhH8hdjSrUdxfzToWMjheqvWwYbr/';

async function main() {
    await mkdir(path.resolve('output', 'meta'), { recursive: true });
    for (let i = 0; i < 1000; i++) {
        await writeFile(path.resolve('output', 'meta', i + '.json'), JSON.stringify({
            name: 'Whale #'+i,
            description: 'Some description about Whale #'+i,
            image: path.join(IMAGES_BASE_PATH, i + '.png'),
        }));

        await writeFile(path.resolve('output', 'meta', 'collection.json'), JSON.stringify({
            name: 'Whales Club',
            description: 'Whales club is the most useful NFT in TON',
            external_link: 'https://tonwhales.com/club',
            image: path.join(IMAGES_BASE_PATH, 'logo.png'),
        }));
    }
}
main();