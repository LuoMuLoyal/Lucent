import { compactFactArguments } from './fact-arguments.js';

describe('compactFactArguments', () => {
  it('drops null values so generated clients can deserialize the map', () => {
    expect(
      compactFactArguments({
        title: '咳嗽',
        endedAt: null,
        reasonRecordTitle: null,
        symptomRecordCount: 0,
      }),
    ).toEqual({ title: '咳嗽', symptomRecordCount: 0 });
  });

  it('drops undefined values as well', () => {
    expect(compactFactArguments({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it('keeps falsy but present values', () => {
    expect(
      compactFactArguments({
        zero: 0,
        empty: '',
        no: false,
        emptyList: [],
        emptyMap: {},
      }),
    ).toEqual({ zero: 0, empty: '', no: false, emptyList: [], emptyMap: {} });
  });
});
