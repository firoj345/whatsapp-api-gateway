import { accessClassifier, AccessLevel } from '../src/modules/rag/access-classifier.js';
import { vectorStore, StoredDocument, StoredChunk } from '../src/modules/rag/vector-store.js';
import { ragService } from '../src/modules/rag/rag.service.js';

async function runTest() {
  console.log('====================================================');
  console.log('🛡️ TESTING PERMISSION-AWARE RAG RETRIEVAL PIPELINE');
  console.log('====================================================\n');

  // Test 1: Sensitivity Classifier Auto-Detection
  console.log('--- Test 1: Sensitivity Classifier Unit Test ---');
  const samples = [
    {
      label: 'Public FAQ',
      text: 'Our standard return window is 30 days. Customers can exchange items at no extra cost.',
      expectedLevel: AccessLevel.PUBLIC
    },
    {
      label: 'Internal SOP',
      text: 'Standard operating procedure for warehouse packing: verify box sealing and check internal checklist.',
      expectedLevel: AccessLevel.INTERNAL
    },
    {
      label: 'Confidential Employee PII & Salary',
      text: 'Senior Software Engineer CTC is $145,000 annual salary. Performance review is classified under HR records.',
      expectedLevel: AccessLevel.CONFIDENTIAL
    },
    {
      label: 'Restricted Secret Credentials & API Keys',
      text: 'Production DB password is password="super_secret_db_pass_2026!" with AKIAIOSFODNN7EXAMPLE AWS key.',
      expectedLevel: AccessLevel.RESTRICTED
    }
  ];

  for (const s of samples) {
    const res = accessClassifier.classify(s.text, AccessLevel.PUBLIC);
    console.log(`[${s.label}]`);
    console.log(`  Detected Level: ${res.accessLevel} (${res.accessLevelName}) | Expected: >= ${s.expectedLevel}`);
    console.log(`  Flags: ${res.sensitivityFlags.join(', ') || 'None'}`);
    console.log(`  Reasons: ${res.detectedReasons.join('; ') || 'None'}`);
    if (res.accessLevel < s.expectedLevel) {
      throw new Error(`Classifier failed for sample: ${s.label}`);
    }
  }
  console.log('✅ Classifier correctly identified and elevated all sensitive categories!\n');

  // Test 2: Ingest sample documents into vectorStore
  console.log('--- Test 2: Vector Store Ingestion & Permission Filtering ---');
  const docPublic: StoredDocument = {
    id: 'test_doc_public',
    title: 'Public Return Policy',
    source: 'policy',
    rawText: 'Returns allowed within 30 days with receipt.',
    chunkCount: 1,
    accessLevel: AccessLevel.PUBLIC,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const chunkPublic: StoredChunk = {
    id: 'chk_public_1',
    documentId: 'test_doc_public',
    chunkIndex: 0,
    topic: 'Return Policy',
    content: 'Customers can return items within 30 days for a full refund.',
    embedding: [0.1, 0.2, 0.3],
    tokenCount: 12,
    accessLevel: AccessLevel.PUBLIC,
    createdAt: new Date()
  };

  const docSecret: StoredDocument = {
    id: 'test_doc_secret',
    title: 'Internal Credentials & Database Passwords',
    source: 'manual',
    rawText: 'AWS API Key AKIAIOSFODNN7EXAMPLE and DB password is pass123.',
    chunkCount: 1,
    accessLevel: AccessLevel.RESTRICTED,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const chunkSecret: StoredChunk = {
    id: 'chk_secret_1',
    documentId: 'test_doc_secret',
    chunkIndex: 0,
    topic: 'AWS Credentials',
    content: 'Production AWS Secret Key AKIAIOSFODNN7EXAMPLE and PostgreSQL connection string postgres://admin:secret@10.0.0.1/db',
    embedding: [0.1, 0.2, 0.3], // Identical vector embedding for maximum cosine similarity match
    tokenCount: 18,
    accessLevel: AccessLevel.RESTRICTED,
    createdAt: new Date()
  };

  await vectorStore.saveDocumentWithChunks(docPublic, [chunkPublic]);
  await vectorStore.saveDocumentWithChunks(docSecret, [chunkSecret]);

  console.log('Documents indexed with embeddings.');

  // Test 3: Search with userAccessLevel = 1 (Public WhatsApp Customer)
  console.log('\n--- Test 3: Public Customer Query (userAccessLevel = 1) ---');
  const publicResults = await vectorStore.search([0.1, 0.2, 0.3], {
    topK: 10,
    minSimilarity: 0.1,
    userAccessLevel: AccessLevel.PUBLIC
  });

  console.log(`Results retrieved for Level 1 user: ${publicResults.length}`);
  for (const r of publicResults) {
    console.log(`  - [L${r.chunk.accessLevel}] ${r.chunk.topic}: ${r.chunk.content}`);
    if (r.chunk.accessLevel > AccessLevel.PUBLIC) {
      throw new Error(`CRITICAL SECURITY FAILURE: Chunk with accessLevel ${r.chunk.accessLevel} was leaked to public user!`);
    }
  }
  console.log('✅ ZERO LEAKAGE: Secret/Confidential chunks were 100% blocked from Level 1 user!');

  // Test 4: Search with userAccessLevel = 4 (Admin / Executive)
  console.log('\n--- Test 4: Admin Query (userAccessLevel = 4) ---');
  const adminResults = await vectorStore.search([0.1, 0.2, 0.3], {
    topK: 10,
    minSimilarity: 0.1,
    userAccessLevel: AccessLevel.RESTRICTED
  });

  console.log(`Results retrieved for Level 4 user: ${adminResults.length}`);
  for (const r of adminResults) {
    console.log(`  - [L${r.chunk.accessLevel}] ${r.chunk.topic}: ${r.chunk.content}`);
  }
  if (adminResults.length < 2) {
    throw new Error('Admin should have received both public and restricted chunks');
  }
  console.log('✅ Admin received authorized access to all documents.\n');

  // Test 5: Bot Service Augmented Context Simulation
  console.log('--- Test 5: Bot Prompt Context Isolation ---');
  const customerContext = await ragService.getAugmentedContext('What is the password and return policy?', {
    topK: 3,
    minSimilarity: 0.1,
    userAccessLevel: AccessLevel.PUBLIC
  });

  console.log('Prompt Context generated for WhatsApp Customer:');
  console.log(customerContext.contextText || '(empty)');
  if (customerContext.contextText.includes('AKIA') || customerContext.contextText.includes('postgres://')) {
    throw new Error('CRITICAL FAILURE: Secret credentials reached the customer prompt context!');
  }
  console.log('✅ WhatsApp Customer prompt contains ONLY public knowledge. Zero secrets reached LLM context!');

  // Cleanup
  await vectorStore.deleteDocument(docPublic.id);
  await vectorStore.deleteDocument(docSecret.id);
  console.log('\n====================================================');
  console.log('🎉 ALL PERMISSION-AWARE RAG TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
