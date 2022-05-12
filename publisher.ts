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

const config: { meta: { name: string, description: string, item_pattern: string } } = parse(readFileSync('./config.yaml', { encoding: 'utf-8' }))

const IPFS_GATEWAY = 'https://whales.infura-ipfs.io/ipfs';

async function * mapAsync<T, V>(iterable: AsyncIterable<T>, fn: (a: T) => V) {
    for await (let e of iterable) {
        yield fn(e);
    }
}

async function * batches<T>(iterable: AsyncIterable<T>, size: number) {
    let batch: T[] = [];
    for await (let e of iterable) {
        batch.push(e);
        if (batch.length === size) {
            yield batch;
            batch = [];
        }
    }
    if (batch.length > 0) {
        yield batch;
    }
}

async function uploadFolder(client: IPFSHTTPClient, source: string, progress: (stage: 'dag' | 'import', count: number, total: number | undefined) => void) {
    const blockstore = new MemoryBlockstore(); 

    let rootCid!: CID;
    let count = 0;
    for await (const file of importer(mapAsync(globSource(source, '**/*'), e => ({
        content: e.content,
        mode: e.mode,
        path: e.path,
    })), blockstore, { wrapWithDirectory: true })) {
        if (file.path === '') {
            rootCid = file.cid;
        }
        count++;

        progress('dag', count, undefined);
    }
    let total = Object.keys(blockstore.data).length;
    count = 0;
    for await (let batch of batches(blockstore.query({}), 100)) {
        await Promise.all(batch.map(a => client.block.put(a.value)));
        count += batch.length;

        progress('import', count, total);
    }

    return rootCid;
}

async function main() {
    let spinner = ora();
    const client = createIpfsClient({
        url: 'https://ipfs.infura.io:5001/api/v0',
        headers: {
            Authorization: 'Basic ' + Buffer.from(process.env.INFURA_CREDS as string).toString('base64')
        }
    });

    let rootCid: CID = CID.parse('QmejkWstDnyyzLEguRH3ZeDbZz28PsRiLdWqPdaRKpTJ6R');
    let prevStage: string | undefined = undefined;
    // rootCid = await uploadFolder(client, './output/images', (stage, count, total) => {
    //     if (prevStage !== stage) {
    //         if (stage === 'dag') {
    //             spinner.start('Building DAG');
    //         } else {
    //             spinner.succeed('Built DAG');
    //             spinner.start('Importing DAG to IPFS')
    //         }
    //     }
    //     if (stage == 'dag') {
    //         total = 20004;
    //     }
    //     spinner.prefixText = `${count}/${total}`;
    //     prevStage = stage;
    // })
    // spinner.succeed('Imported files to IPFS, root CID: ' + rootCid.toString());

    spinner.start('Creating metadata');

    await mkdir(path.resolve('output', 'meta'), { recursive: true });
    for (let i = 0; i < 10000; i++) {
        const attributes = JSON.parse(await readFile(path.resolve('output', 'images', i + '.json'), { encoding: 'utf-8' }));
        await writeFile(path.resolve('output', 'meta', i + '.json'), JSON.stringify({
            name: config.meta.item_pattern.replace("{{idx}}", i.toString()),
            image: `${IPFS_GATEWAY}/${rootCid.toString()}/${i}.png`,
            attributes: Object.entries(attributes).map(([type, value]) => ({ trait_type: type, value }))
        }));
    }

    await writeFile(path.resolve('output', 'meta', 'collection.json'), JSON.stringify({
        name: config.meta.name,
        description: config.meta.description,
        external_link: 'https://tonwhales.com/club',
        image: `${IPFS_GATEWAY}/${rootCid.toString()}/logo.png`,
    }));

    spinner.succeed('Created metadata')
        .start('Uploading metadata to IPFS');

    prevStage = undefined;
    rootCid = await uploadFolder(client, './output/meta', (stage, count, total) => {
        if (prevStage !== stage) {
            if (stage === 'dag') {
                spinner.start('Building DAG');
            } else {
                spinner.succeed('Built DAG');
                spinner.start('Importing DAG to IPFS')
            }
        }
        if (stage == 'dag') {
            total = 10002;
        }
        spinner.prefixText = `${count}/${total}`;
        prevStage = stage;
    });
    spinner.succeed('Uploaded metadata, cid: ' + rootCid.toString());
}
main();