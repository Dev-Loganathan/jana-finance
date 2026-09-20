import { S3Driver } from "../src/storage/storage.service";

/** In-memory stand-in for the S3 client: understands just Put/Get/Delete, like a bucket would. */
function fakeBucket() {
  const objects = new Map<string, Buffer>();
  const calls: string[] = [];
  const client = {
    send: async (cmd: { constructor: { name: string }; input: { Bucket: string; Key: string; Body?: Buffer } }) => {
      const { Bucket, Key, Body } = cmd.input;
      calls.push(`${cmd.constructor.name} ${Bucket}/${Key}`);
      if (cmd.constructor.name === "PutObjectCommand") objects.set(`${Bucket}/${Key}`, Body!);
      if (cmd.constructor.name === "DeleteObjectCommand") objects.delete(`${Bucket}/${Key}`);
      if (cmd.constructor.name === "GetObjectCommand") {
        const data = objects.get(`${Bucket}/${Key}`);
        if (!data) throw new Error("NoSuchKey");
        return { Body: { transformToByteArray: async () => new Uint8Array(data) } };
      }
      return {};
    },
  };
  return { client: client as never, objects, calls };
}

describe("S3Driver", () => {
  it("stores, reads back and deletes an object in the configured bucket", async () => {
    const { client, objects, calls } = fakeBucket();
    const driver = new S3Driver("jana-docs", client);
    const data = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);

    await driver.put("customers/abc/aadhaar.pdf", data);
    expect(objects.get("jana-docs/customers/abc/aadhaar.pdf")).toEqual(data);
    expect((await driver.get("customers/abc/aadhaar.pdf")).equals(data)).toBe(true);

    await driver.delete("customers/abc/aadhaar.pdf");
    await expect(driver.get("customers/abc/aadhaar.pdf")).rejects.toThrow();
    expect(calls).toEqual([
      "PutObjectCommand jana-docs/customers/abc/aadhaar.pdf",
      "GetObjectCommand jana-docs/customers/abc/aadhaar.pdf",
      "DeleteObjectCommand jana-docs/customers/abc/aadhaar.pdf",
      "GetObjectCommand jana-docs/customers/abc/aadhaar.pdf",
    ]);
  });
});
