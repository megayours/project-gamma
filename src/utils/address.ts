export type AddressHex = `0x${string}`;

export function isAddressHex(address: string): address is AddressHex {
  return address.startsWith('0x');
}

export function toAddressHex(address: string): AddressHex {
  return (address.startsWith('0x') ? address : `0x${address}`) as AddressHex;
}

export function toAddress(address: AddressHex): string {
  return address.slice(2);
}

export function toBuffer(address: AddressHex | string): Buffer {
  return Buffer.from(address.replace('0x', ''), 'hex');
}

export function toAddressHexFromBuffer(buffer: Buffer): AddressHex {
  return `0x${buffer.toString('hex')}` as AddressHex;
}
