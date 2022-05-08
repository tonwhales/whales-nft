import { writeFile } from 'fs/promises';
import * as path from 'path';


async function main() {
    for (let i = 0; i < 1000; i++) {
        await writeFile(path.resolve('output', 'meta', i + '.json'), JSON.stringify({
            name: 'Whale #'+i,
            description: 'Some description about Whale #'+i,
            image: 'https://whales.infura-ipfs.io/ipfs/QmaJAXD6xoMT2Marz7MhH8hdjSrUdxfzToWMjheqvWwYbr/' + i + '.png',
        }));

        await writeFile(path.resolve('output', 'meta', 'collection.json'), JSON.stringify({
            name: 'Whales Club',
            description: 'Whales club is the most useful NFT in TON',
            external_link: 'https://tonwhales.com/club'
        }));
    }
}
main();