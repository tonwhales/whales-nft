import { mkdir, readFile, writeFile } from 'fs/promises';
import { globSource, create as createIpfsClient, CID, IPFSHTTPClient } from 'ipfs-http-client';
import ora from 'ora';
import { importer } from 'ipfs-unixfs-importer'
import path from 'path';
import { MemoryBlockstore } from 'blockstore-core/memory';
import dotenv from 'dotenv';
import { parse } from 'yaml';
import { readFileSync } from 'fs';

dotenv.config();

const config: { logo: string, cover: string, meta: { name: string, description: string, item_pattern: string, social_links: string[], external_url: string } } = parse(readFileSync('./config.yaml', { encoding: 'utf-8' }))

const IPFS_GATEWAY = 'ipfs:/';


async function main() {
    let spinner = ora();
    const client = createIpfsClient({
        url: 'https://ipfs.infura.io:5001/api/v0',
        headers: {
            Authorization: 'Basic ' + Buffer.from(process.env.INFURA_CREDS as string).toString('base64')
        }
    });

    let rootCid: CID | undefined;
    for await (let e of client.addAll(globSource('./output/misc', '**/*'), { pin: true, wrapWithDirectory: true })) {
        if (e.path === '') {
            rootCid = e.cid;
        }
    }
    if (!rootCid) {
        throw new Error('no root cid');
    }
    spinner.succeed('Imported files to IPFS, root CID: ' + rootCid.toString());


    spinner.start('Creating metadata');

    const content = JSON.stringify({
        name: config.meta.name,
        description: config.meta.description,
        external_link: config.meta.external_url,
        external_url: config.meta.external_url,
        image: `${IPFS_GATEWAY}/${rootCid.toString()}/${config.logo}`,
        social_links: config.meta.social_links,
        cover_image: `${IPFS_GATEWAY}/${rootCid.toString()}/${config.cover}`
    });

    await writeFile(path.resolve('output', 'collection.json'), content);

    spinner.succeed('Created metadata')
        .start('Uploading metadata to IPFS');

    let result = await client.add({ content }, { pin: true });
    spinner.succeed('Uploaded metadata, cid: ' + result.cid.toString());
}
main();