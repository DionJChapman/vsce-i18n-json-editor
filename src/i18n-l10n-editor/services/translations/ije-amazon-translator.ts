import axios, { AxiosError, AxiosResponse, AxiosResponseTransformer } from 'axios';
import * as vscode from 'vscode';
import * as CryptoJS from 'crypto-js';
//import {formatDate} from '@angular/common';

import { IJEConfiguration } from '../../ije-configuration';
import { IJETranslation } from './ije-translation';
import { IJEDataTranslation } from '../../models/ije-data-translation';
import { IJEManager } from '../../ije-manager';

export class IJEAmazonTranslator implements IJETranslation {
    results: { [language: string]: string };
    _manager: IJEManager;
    async translate(text: string, translation: IJEDataTranslation, language: string, languages: string[]): Promise<{ [language: string]: string }> {
        const apiKey = IJEConfiguration.TRANSLATION_SERVICE_API_KEY;
        if (apiKey && apiKey.length === 0) {
            vscode.window.showErrorMessage('Your Amazon API Key is blank. please update setting i18nJsonEditor.translationServiceApiKey');

            return { [language]: text };
        }

        const apiSecret = IJEConfiguration.TRANSLATION_SERVICE_API_SECRET;
        if (apiSecret && apiSecret.length === 0) {
            vscode.window.showErrorMessage('Your Amazon API Secret is blank. please update setting i18nJsonEditor.translationServiceApiKey');

            return { [language]: text };
        }

        const apiRegion = IJEConfiguration.TRANSLATION_SERVICE_API_REGION;
        if (apiRegion && apiRegion.length === 0) {
            vscode.window.showErrorMessage('Your Amazon API Region is blank. please update setting i18nJsonEditor.translationServiceApiRegion');

            return { [language]: text };
        }

        const endpoint = `https://translate.${apiRegion}.amazonaws.com`;

        let _languages = [];

        if (text === undefined || text.length === 0) {
            return { [language]: text };
        }

        // we only need the language and not the file name
        let split = language.split('_');
        if (split.length === 2 && split[0].length === 2) {
            language = split[0];
        } else if (split.length === 2) {
            language = split[1];
        } else if (split.length === 3) {
            language = split[1];
        }

        for (let l = 0; l < languages.length; ++l) {
            let lang = languages[l];
            let split = lang.split('_');
            if (split.length === 2 && split[0].length === 2) {
                lang = split[0];
            } else if (split.length === 2) {
                lang = split[1];
            } else if (split.length === 3) {
                lang = split[1];
            }
            if (language !== languages[l]) {
                _languages.push(lang);
            }
        }

        // need to save the {text} so we can put them back afterwards
        const _substitutes: string[] = [];
        let place = 0;
        while (true) {
            if (text.indexOf('}', place) > text.indexOf('{', place)) {
                _substitutes.push(text.substring(text.indexOf('{', place), text.indexOf('}', place) + 1));
                place = text.indexOf('}', place) + 1;
            } else {
                break;
            }
        }

        // prepare the headers
        const yyyyMMdd = formatYYYYMMDD(new Date());
        const yyyyMMddTHHmmssZ = formatYYYYMMDDhhmmss(new Date());
        const dateKey = CryptoJS.HmacSHA256(`AWS4${apiSecret}`, yyyyMMdd);
        const dateRegionKey = CryptoJS.HmacSHA256(dateKey, apiRegion);
        const dateRegionServiceKey = CryptoJS.HmacSHA256(dateRegionKey, 'translate');
        const signatureKey = CryptoJS.HmacSHA256(dateRegionServiceKey, 'aws4_request');
        const signature = signatureKey.toString(CryptoJS.enc.Hex);

        await _languages.forEach(async lang => {
            try {
                var response = await axios({
                    baseURL: endpoint,
                    method: 'post',
                    headers: {
                        'Content-type': 'application/x-amz-json-1.1',
                        'X-Amz-Target': 'AWSShineFrontendService_20170701.TranslateText',
                        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
                        'X-Amz-Credential': `${apiKey}/${yyyyMMdd}/${apiRegion}/translate/aws4_request`,
                        'X-Amz-Date': `${yyyyMMddTHHmmssZ}`,
                        'X-Amz-SignedHeaders': 'host;x-amz-date',
                        'X-Amz-Signature': signature
                    },
                    params: {
                        Text: text,
                        SourceLangCode: language.replace('_', '-'),
                        TargetLanguageCode: lang.replace('_', '-')
                    },
                    responseType: 'json'
                });

                const data = response.data;

                if (data.length === 0) {
                    return { [language]: text };
                }

                const results = Object.assign(
                    {},
                    ...languages
                        .filter(l => l !== language)
                        .map(l => ({
                            [l]: data[0].translations.filter(t => {
                                let to = t.to;
                                if (to.indexOf('-') !== -1) {
                                    to = t.to.substring(0, t.to.indexOf('-'));
                                }
                                // if (to.indexOf('-') !== -1) {
                                //     to = t.to.substring(0, t.to.indexOf('-'));
                                // }
                                if (l.indexOf(to) !== -1 || l.indexOf(t.to) !== -1) {
                                    return t.text as string;
                                }
                            })
                        }))
                );

                languages
                    .filter(l => l !== language)
                    .forEach(l => {
                        if (results[l]) {
                            let r = results[l][0];
                            if (r) {
                                let _text = r['text'];
                                //const _l = r['to'];
                                place = 0;
                                _substitutes.forEach(s => {
                                    if (_text.indexOf('}', place) > _text.indexOf('{', place)) {
                                        _text = _text.substring(0, _text.indexOf('{', place) - 1) + s + _text.substring(_text.indexOf('}', place) + 1);
                                        place = _text.indexOf('}', place) + 1;
                                    }
                                });
                                translation.languages[l] = _text;
                                //translation.languages[_l] = _text;
                                this._manager.refreshDataTable();
                                //const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                                //sleep(250);
                            }
                        }
                    });

                return this.results;
            } catch (e) {
                let err = e as AxiosError;
                let r = err.response as AxiosResponse;
                vscode.window.showErrorMessage(`${e.toString()}\n${r !== undefined ? r.data : ''}\nlangage ${lang} - ${text}`);
            }
        });
    }
}

function formatYYYYMMDD(inputDate: Date) {
    let date, month, year;

    date = inputDate.getDate();
    month = inputDate.getMonth() + 1;
    year = inputDate.getFullYear();

    date = date.toString().padStart(2, '0');
    month = month.toString().padStart(2, '0');

    return `${date}/${month}/${year}`;
}

function formatYYYYMMDDhhmmss(inputDate: Date) {
    let date, month, year, hour, minute, second;

    date = inputDate.getDate();
    month = inputDate.getMonth() + 1;
    year = inputDate.getFullYear();
    hour = inputDate.getHours();
    minute = inputDate.getMinutes();
    second = inputDate.getSeconds();

    date = date.toString().padStart(2, '0');
    month = month.toString().padStart(2, '0');
    hour = hour.toString().padStart(2, '0');
    minute = minute.toString().padStart(2, '0');
    second = second.toString().padStart(2, '0');

    return `${year}${month}${date}T${hour}${minute}${second}Z`;
}

