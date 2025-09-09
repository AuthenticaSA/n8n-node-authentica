import {
	NodeApiError,
	NodeOperationError,
	NodeConnectionType, // value import (enum)
} from 'n8n-workflow';

import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
	IHttpRequestOptions,
} from 'n8n-workflow';

/**
 * ---------- Helper functions ----------
 * Kept OUTSIDE the class so we can call with `.call(this, ...)`
 */

// Improved validation functions with null safety
function isE164(phone: string) { return /^\+[1-9]\d{6,14}$/.test((phone ?? '').trim()); }
function isEmail(v: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v ?? '').trim()); }


async function doRequest(
	this: IExecuteFunctions,
	method: 'GET' | 'POST' | 'DELETE',
	path: string,
	body?: IDataObject,
	i = 0,
) {
	// Use credentials (API Key flow)
	const creds = await this.getCredentials('authenticaApi');
	const baseUrl = (creds?.baseUrl as string) || 'https://api.authentica.sa';


	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${path}`,
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		json: true,
	};

	if (method !== 'GET' && body) {
		options.body = body;

	}

	// Injects X-Authorization from credentials
	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(this, 'authenticaApi', options);
		return response;
	} catch (error) {
		throw error;
	}
}



/**
 * ---------- Node ----------
 */
type Resource = 'account' | 'otp';
type Operation = 'getBalance' | 'send' | 'verify';

export class Authentica implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Authentica',
		name: 'authentica',
		icon: 'file:authentica.svg',
		group: ['transform'],
		version: 1,
		description: 'OTP and account balance via Authentica',
		defaults: { name: 'Authentica' },
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [{ name: 'authenticaApi', required: true }],
		properties: [
			// ------------- Resource -------------
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'OTP', value: 'otp' },
				],
				default: 'otp',
			},

			// ------------- OTP -------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['otp'] } },
				options: [
					{ name: 'Send', value: 'send', action: 'Send an OTP', description: 'Send an OTP' },
					{ name: 'Verify', value: 'verify', action: 'Verify an OTP', description: 'Verify an OTP' },
				],
				default: 'send',
			},
			{
				displayName: 'Method',
				name: 'otpMethod',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Email', value: 'email' },
					{ name: 'SMS', value: 'sms' },
					{ name: 'WhatsApp', value: 'whatsapp' },
				],
				default: 'sms',
				displayOptions: { show: { resource: ['otp'], operation: ['send'] } },
			},
			{
				displayName: 'Phone',
				name: 'phone',
				type: 'string',
				placeholder: '+9665XXXXXXXX',
				default: '',
				displayOptions: { show: { resource: ['otp'], operation: ['send'], otpMethod: ['sms', 'whatsapp'] } },
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'user@example.com',
				default: '',
				displayOptions: { show: { resource: ['otp'], operation: ['send'], otpMethod: ['email'] } },
			},
			{
				displayName: 'Verify With',
				name: 'verifyWith',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Phone', value: 'phone' },
					{ name: 'Email', value: 'email' },
				],
				default: 'phone',
				displayOptions: { show: { resource: ['otp'], operation: ['verify'] } },
			},
			{
				displayName: 'Phone',
				name: 'verifyPhone',
				type: 'string',
				placeholder: '+9665XXXXXXXX',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['otp'], operation: ['verify'], verifyWith: ['phone'] } },
			},
			{
				displayName: 'Email',
				name: 'verifyEmail',
				type: 'string',
				placeholder: 'user@example.com',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['otp'], operation: ['verify'], verifyWith: ['email'] } },
			},
			{
				displayName: 'OTP Code',
				name: 'otp',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['otp'], operation: ['verify'] } },
			},

			// ------------- Account -------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [{ name: 'Get Balance', value: 'getBalance', action: 'Get balance' }],
				default: 'getBalance',
			},

			// ------------- Advanced -------------
			{
				displayName: 'Include Raw Response',
				name: 'includeRaw',
				type: 'boolean',
				default: false,
				hint: 'Attach full API response under `raw` (for debugging).',
			},
		],
	};

	// ---------------------------------------------------

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const resource = this.getNodeParameter('resource', 0) as Resource;
		const operation = this.getNodeParameter('operation', 0) as Operation;
		const includeRaw = this.getNodeParameter('includeRaw', 0, false) as boolean;

		for (let i = 0; i < items.length; i++) {
			try {
				let out: IDataObject = {};
				let res: IDataObject | undefined;

				// ---------- OTP ----------
				if (resource === 'otp' && operation === 'send') {
					const method = this.getNodeParameter('otpMethod', i) as string;
					const phone = this.getNodeParameter('phone', i, '') as string;
					const email = this.getNodeParameter('email', i, '') as string;

					if (method !== 'email') {
						if (!isE164(phone)) throw new NodeOperationError(this.getNode(), 'Phone must be E.164, e.g. +9665XXXXXXX');
					} else {
						if (!isEmail(email)) throw new NodeOperationError(this.getNode(), 'Email is not valid');
					}

					const body: IDataObject = { method };
					if (method === 'email') body.email = email;
					else body.phone = phone;

					res = (await doRequest.call(this, 'POST', '/api/v2/send-otp', body, i)) as IDataObject;
					out = { success: true };
				}

				if (resource === 'otp' && operation === 'verify') {
					const verifyWith = this.getNodeParameter('verifyWith', i) as string;
					const otp = this.getNodeParameter('otp', i) as string;

					const body: IDataObject = { otp };
					if (verifyWith === 'email') {
						body.email = this.getNodeParameter('verifyEmail', i) as string;
						if (!isEmail(body.email as string)) {
							throw new NodeOperationError(this.getNode(), 'Email is not valid');
						}
					} else {
						body.phone = this.getNodeParameter('verifyPhone', i) as string;
						if (!isE164(body.phone as string)) {
							throw new NodeOperationError(this.getNode(), 'Phone must be E.164, e.g. +9665XXXXXXX');
						}
					}

					res = (await doRequest.call(this, 'POST', '/api/v2/verify-otp', body, i)) as IDataObject;
					out = { verified: true };
				}


				// ---------- Account ----------
				if (resource === 'account' && operation === 'getBalance') {
					res = (await doRequest.call(this, 'GET', '/api/v2/balance', undefined, i)) as IDataObject;

					const data = (res.data as IDataObject) ?? res;
					const balance = (data?.balance as number | undefined) ?? (data?.data as IDataObject)?.balance;
					out = { balance };
				}

				if (includeRaw && res) out.raw = res;

				returnData.push({ json: out });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
