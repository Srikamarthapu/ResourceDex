export type ReferenceNote = {
  text: string;
  applicability: string;
  source: {
    id: string;
    title: string;
    publisher: string;
    url: string;
    locator: string;
    contentHash: string;
    corpusVersion: string;
  };
};
