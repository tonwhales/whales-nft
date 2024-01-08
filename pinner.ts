
import { create as createIpfsClient } from 'ipfs-http-client';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    const client = createIpfsClient({
        url: 'https://ipfs.infura.io:5001/api/v0',
        headers: {
            Authorization: 'Basic ' + Buffer.from(process.env.INFURA_CREDS as string).toString('base64')
        }
    });

    // collection metadata
    await client.pin.add('QmYb6XduLLjFXhkbz4ggDHVfPyG6gapYzzLH7tGj9vFprH');

    // Images root
    await client.pin.add('QmQ5QiuLBEmDdQmdWcEEh2rsW53KWahc63xmPVBUSp4teG', { recursive: true });

    // Metadata root
    await client.pin.add('QmTWEGggE2j4mnX4kMjBLzhV3K5RDxyJTby8ZPb4RjV1Ug', { recursive: true });

    // Misc root
    await client.pin.add('QmWB2RWNC1z45QnmHrdjicESgE1GKzsYdMMusbXChR2zxL', { recursive: true });

    // Integrity check
    for await (let file of client.pin.ls({ type: 'recursive' })) {
        console.log(file);
    }
}
main();