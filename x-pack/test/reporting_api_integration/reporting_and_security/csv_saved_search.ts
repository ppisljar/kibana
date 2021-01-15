/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import expect from '@kbn/expect';
import supertest from 'supertest';
import { JobParamsDownloadCSV } from '../../../plugins/reporting/server/export_types/csv_from_savedobject/types';
import { FtrProviderContext } from '../ftr_provider_context';

const getMockJobParams = (obj: Partial<JobParamsDownloadCSV>): JobParamsDownloadCSV => ({
  title: `Don't Stop Believin'`,
  ...(obj as any),
});

// eslint-disable-next-line import/no-default-export
export default function ({ getService }: FtrProviderContext) {
  const esArchiver = getService('esArchiver');
  const supertestSvc = getService('supertest');
  const reportingAPI = getService('reportingAPI');

  const generateAPI = {
    getCSVFromSearchSource: async ({ timerange, title, searchSource }: JobParamsDownloadCSV) => {
      return await supertestSvc
        .post(`/api/reporting/v1/generate/immediate/csv/search_source`)
        .set('kbn-xsrf', 'xxx')
        .send({ timerange, searchSource, title });
    },
  };

  describe('CSV generation from SearchSource', () => {
    after(async () => {
      await reportingAPI.deleteAllReports();
    });

    describe('CSV from results', () => {
      it('unfiltered search', async () => {
        // load test data that contains a saved search and documents
        await esArchiver.load('reporting/ecommerce');
        await esArchiver.load('reporting/ecommerce_kibana');

        const res = (await generateAPI.getCSVFromSearchSource(
          getMockJobParams({
            timerange: {
              min: '2019-04-28T21:23:50Z',
              max: '2019-07-28T10:09:33Z',
              timezone: 'UTC',
            },
            title: 'Ecommerce Data',
            searchSource: {
              fields: ['*'],
              fieldsFromSource: [
                'order_date',
                'category',
                'currency',
                'customer_id',
                'order_id',
                'day_of_week_i',
                'order_date',
                'products.created_on',
                'sku',
              ],
              filter: [],
              index: '5193f870-d861-11e9-a311-0fa548c5f953',
              query: { language: 'kuery', query: 'eddie' },
              version: true,
            },
          })
        )) as supertest.Response;
        const { status: resStatus, text: resText, type: resType } = res;

        expect(resStatus).to.eql(200);
        expect(resType).to.eql('text/csv');
        expectSnapshot(resText).toMatchInline(`
          "geoip,\\"customer_first_name\\",\\"customer_phone\\",type,\\"products.tax_amount\\",\\"products.taxful_price\\",\\"products.quantity\\",\\"products.taxless_price\\",\\"products.discount_amount\\",\\"products.base_unit_price\\",\\"products.discount_percentage\\",\\"products.product_name\\",\\"products.manufacturer\\",\\"products.min_price\\",\\"products.created_on\\",\\"products.price\\",\\"products.unit_discount_amount\\",\\"products.product_id\\",\\"products.base_price\\",\\"products._id\\",\\"products.category\\",\\"products.sku\\",\\"customer_full_name\\",\\"order_date\\",\\"customer_last_name\\",\\"day_of_week_i\\",\\"total_quantity\\",currency,\\"taxless_total_price\\",\\"total_unique_products\\",\\"customer_id\\",\\"order_id\\",user,\\"customer_gender\\",email,\\"day_of_week\\",\\"taxful_total_price\\"
          [object Object],Eddie,,order,0,11.99,24.99,1,1,11.99,24.99,0,11.99,24.99,0,Basic T-shirt - dark blue/white,Sweatshirt - grey multicolor,Elitelligence,Oceanavigations,6.35,11.75,2016-12-26T00:00:00+00:00,2016-12-26T00:00:00+00:00,11.99,24.99,0,6283,19400,11.99,24.99,sold_product_584677_6283,sold_product_584677_19400,Men's Clothing,Men's Clothing,ZO0549605496,ZO0299602996,Eddie Underwood,2019-07-07T00:00:00+00:00,Underwood,0,2,EUR,36.98,2,38,584677,eddie,MALE,eddie@underwood-family.zzz,Monday,36.98
          [object Object],Eddie,,order,0,59.99,20.99,1,1,59.99,20.99,0,59.99,20.99,0,Winter jacket - black,Watch - green,Elitelligence,Elitelligence,28.2,10.7,2016-12-19T00:00:00+00:00,2016-12-19T00:00:00+00:00,59.99,20.99,0,11262,15713,59.99,20.99,sold_product_574916_11262,sold_product_574916_15713,Men's Clothing,Men's Accessories,ZO0542505425,ZO0601306013,Eddie Weber,2019-06-30T00:00:00+00:00,Weber,0,2,EUR,80.98,2,38,574916,eddie,MALE,eddie@weber-family.zzz,Monday,80.98
          [object Object],Eddie,,order,0,17.99,10.99,16.99,22.99,1,1,1,1,17.99,10.99,16.99,22.99,0,17.99,10.99,16.99,22.99,0,Belt - black,Gloves - dark grey multicolor/bordeaux,Long sleeved top - khaki,Hoodie - mottled light grey,Angeldale,Low Tide Media,Oceanavigations,Elitelligence,8.28,5.06,8.83,11.04,2016-12-27T00:00:00+00:00,2016-12-27T00:00:00+00:00,2016-12-27T00:00:00+00:00,2016-12-27T00:00:00+00:00,17.99,10.99,16.99,22.99,0,19655,12500,17739,23793,17.99,10.99,16.99,22.99,sold_product_718424_19655,sold_product_718424_12500,sold_product_718424_17739,sold_product_718424_23793,Men's Accessories,Men's Accessories,Men's Clothing,Men's Clothing,ZO0700707007,ZO0459704597,ZO0293702937,ZO0592705927,Eddie Gregory,2019-07-08T00:00:00+00:00,Gregory,1,4,EUR,68.96,4,38,718424,eddie,MALE,eddie@gregory-family.zzz,Tuesday,68.96
          "
        `);

        await esArchiver.unload('reporting/ecommerce');
        await esArchiver.unload('reporting/ecommerce_kibana');
      });

      it('filtered search', async () => {
        // load test data that contains a saved search and documents
        await esArchiver.load('reporting/ecommerce');
        await esArchiver.load('reporting/ecommerce_kibana');

        const res = (await generateAPI.getCSVFromSearchSource(
          getMockJobParams({
            timerange: {
              min: '2019-04-28T21:23:50Z',
              max: '2019-07-28T10:09:33Z',
              timezone: 'UTC',
            },
            title: 'Ecommerce Data',
            searchSource: {
              fields: ['*'],
              fieldsFromSource: [
                'order_date',
                'category',
                'currency',
                'customer_id',
                'order_id',
                'day_of_week_i',
                'order_date',
                'products.created_on',
                'sku',
              ],
              filter: [],
              index: '5193f870-d861-11e9-a311-0fa548c5f953',
              query: { language: 'kuery', query: '' },
              version: true,
            },
          })
        )) as supertest.Response;
        const { status: resStatus, text: resText, type: resType } = res;

        expect(resStatus).to.eql(200);
        expect(resType).to.eql('text/csv');
        expectSnapshot(resText).toMatchInline(`
          "geoip,\\"customer_first_name\\",\\"customer_phone\\",type,\\"products.tax_amount\\",\\"products.taxful_price\\",\\"products.quantity\\",\\"products.taxless_price\\",\\"products.discount_amount\\",\\"products.base_unit_price\\",\\"products.discount_percentage\\",\\"products.product_name\\",\\"products.manufacturer\\",\\"products.min_price\\",\\"products.created_on\\",\\"products.price\\",\\"products.unit_discount_amount\\",\\"products.product_id\\",\\"products.base_price\\",\\"products._id\\",\\"products.category\\",\\"products.sku\\",\\"customer_full_name\\",\\"order_date\\",\\"customer_last_name\\",\\"day_of_week_i\\",\\"total_quantity\\",currency,\\"taxless_total_price\\",\\"total_unique_products\\",\\"customer_id\\",\\"order_id\\",user,\\"customer_gender\\",email,\\"day_of_week\\",\\"taxful_total_price\\"
          [object Object],Eddie,,order,0,11.99,24.99,1,1,11.99,24.99,0,11.99,24.99,0,Basic T-shirt - dark blue/white,Sweatshirt - grey multicolor,Elitelligence,Oceanavigations,6.35,11.75,2016-12-26T00:00:00+00:00,2016-12-26T00:00:00+00:00,11.99,24.99,0,6283,19400,11.99,24.99,sold_product_584677_6283,sold_product_584677_19400,Men's Clothing,Men's Clothing,ZO0549605496,ZO0299602996,Eddie Underwood,2019-07-07T00:00:00+00:00,Underwood,0,2,EUR,36.98,2,38,584677,eddie,MALE,eddie@underwood-family.zzz,Monday,36.98
          [object Object],Mary,,order,0,24.99,28.99,1,1,24.99,28.99,0,24.99,28.99,0,Denim dress - black denim,Shorts - black,Champion Arts,Pyramidustries,11.75,15.65,2016-12-25T00:00:00+00:00,2016-12-25T00:00:00+00:00,24.99,28.99,0,11238,20149,24.99,28.99,sold_product_584021_11238,sold_product_584021_20149,Women's Clothing,Women's Clothing,ZO0489604896,ZO0185501855,Mary Bailey,2019-07-06T00:00:00+00:00,Bailey,6,2,EUR,53.98,2,20,584021,mary,FEMALE,mary@bailey-family.zzz,Sunday,53.98
          [object Object],Gwen,,order,0,99.99,99.99,1,1,99.99,99.99,0,99.99,99.99,0,Boots - Midnight Blue,Short coat - white/black,Low Tide Media,Oceanavigations,46,53.99,2016-12-25T00:00:00+00:00,2016-12-25T00:00:00+00:00,99.99,99.99,0,22794,23386,99.99,99.99,sold_product_584058_22794,sold_product_584058_23386,Women's Shoes,Women's Clothing,ZO0374603746,ZO0272202722,Gwen Butler,2019-07-06T00:00:00+00:00,Butler,6,2,EUR,199.98,2,26,584058,gwen,FEMALE,gwen@butler-family.zzz,Sunday,199.98
          [object Object],Diane,,order,0,74.99,99.99,1,1,74.99,99.99,0,74.99,99.99,0,High heeled sandals - argento,Classic coat - black,Primemaster,Oceanavigations,34.5,47,2016-12-25T00:00:00+00:00,2016-12-25T00:00:00+00:00,74.99,99.99,0,12304,19587,74.99,99.99,sold_product_584093_12304,sold_product_584093_19587,Women's Shoes,Women's Clothing,ZO0360303603,ZO0272002720,Diane Chandler,2019-07-06T00:00:00+00:00,Chandler,6,2,EUR,174.98,2,22,584093,diane,FEMALE,diane@chandler-family.zzz,Sunday,174.98
          "
        `);

        await esArchiver.unload('reporting/ecommerce');
        await esArchiver.unload('reporting/ecommerce_kibana');
      });
    });
  });
}
