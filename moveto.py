import pinecone

# 1. Setup Connection
pc = pinecone.Pinecone(api_key="pcsk_4qbekV_UaQjtyrxPWE9ZU5ggeDiDCHhpBG2QkE1zCKh6TVaEJBXYWrRmB8Mv1eeMHZ5NSw")
index = pc.Index("plex-index")

def move_to_named_default(index):
    # source_ns = "" is the "unnamed" one
    source_ns = ""
    # target_ns = "default" is the specific name you want
    target_ns = "default"

    print(f"Moving records from [Unnamed] to ['{target_ns}']...")

    # Iterate through all records in the unnamed namespace
    for ids in index.list(namespace=source_ns):
        # Grab the vector data (values + metadata)
        fetch_response = index.fetch(ids=ids, namespace=source_ns)
        vectors = fetch_response['vectors']
        
        upsert_batch = []
        for v_id, v_data in vectors.items():
            upsert_batch.append({
                "id": v_id,
                "values": v_data['values'],
                "metadata": v_data.get('metadata', {})
            })
        
        # Write to the namespace actually named "default"
        if upsert_batch:
            index.upsert(vectors=upsert_batch, namespace=target_ns)
            
            # Delete from the unnamed namespace so they are "moved", not copied
            index.delete(ids=ids, namespace=source_ns)
            print(f"Moved {len(upsert_batch)} records.")

# Run the function
move_to_named_default(index)