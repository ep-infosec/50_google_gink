import { Muid, ChangeSetInfo, Medallion, Timestamp } from "./typedefs";
import { ChangeSet as ChangeSetBuilder } from "gink/protoc.out/change_set_pb";
import { Change as ChangeBuilder } from "gink/protoc.out/change_pb";
import { Entry as EntryBuilder } from "gink/protoc.out/entry_pb";
import { Container as ContainerBuilder } from "gink/protoc.out/container_pb";
import { ensure } from "./utils";

export class ChangeSet {
    // note: this class is unit tested as part of Store.test.ts
    private commitInfo: ChangeSetInfo | null = null;
    private serialized: Uint8Array | null = null;
    private changeSetBuilder = new ChangeSetBuilder();
    private countItems = 0;
 
    constructor(private pendingComment?: string, readonly preAssignedMedallion?: Medallion) { 
    }

    private requireNotSealed() {
        if (this.commitInfo)
            throw new Error("This ChangeSet has already been sealed.");
    }

    get bytes() {
        return ensure(this.serialized, "not yet sealed!");
    }

    set comment(value) {
        this.requireNotSealed();
        this.pendingComment = value;
    }

    get comment(): string | undefined {
        return this.pendingComment || this.commitInfo?.comment;
    }

    get medallion(): Medallion | undefined {
        return this.preAssignedMedallion || this.commitInfo?.medallion;
    }

    get timestamp(): Timestamp | undefined {
        return this.commitInfo?.timestamp;
    }

    addEntry(entryBuilder: EntryBuilder): Muid {
        return this.addChange((new ChangeBuilder()).setEntry(entryBuilder));
    }

    addContainer(containerBuilder: ContainerBuilder): Muid {
        return this.addChange((new ChangeBuilder()).setContainer(containerBuilder));
    }

    /**
     * 
     * @param changeBuilder a protobuf Change ready to be serialized
     * @returns an Address who's offset is immediately available and whose medallion and
     * timestamp become defined when this ChangeSet is sealed.
     */
    addChange(changeBuilder: ChangeBuilder): Muid {
        this.requireNotSealed();
        const offset = ++this.countItems;
        this.changeSetBuilder.getChangesMap().set(offset, changeBuilder);
        // Using an anonymous class here because I only need the interface of Address
        // but I need some non-trivial behavior: the timestamp and possibly medallion 
        // are undefined until the associated change set is finalized, then all of the 
        // components of the address become well defined.
        return new class {
            constructor(private changeSet: ChangeSet, readonly offset: number) {}
            get medallion() { return this.changeSet.medallion; }
            get timestamp() { return this.changeSet.timestamp; }
        }(this, offset);
    }

    removeChange(address: Muid) {
        this.requireNotSealed();
        const map = this.changeSetBuilder.getChangesMap();
        map.delete(address.offset);
    }


    /**
     * Intended to be called by a GinkInstance to finalize a commit.
     * @param commitInfo the commit metadata to add when serializing
     * @returns serialized 
     */
    seal(commitInfo: ChangeSetInfo): ChangeSetInfo {
        this.requireNotSealed();
        if (this.preAssignedMedallion && this.preAssignedMedallion != commitInfo.medallion) {
            throw new Error("specifed commitInfo doesn't match pre-assigned medallion");
        }
        this.commitInfo = {...commitInfo};
        this.commitInfo.comment = this.pendingComment;
        this.changeSetBuilder.setTimestamp(commitInfo.timestamp);
        this.changeSetBuilder.setPreviousTimestamp(commitInfo.priorTime);
        this.changeSetBuilder.setChainStart(commitInfo.chainStart);
        this.changeSetBuilder.setMedallion(commitInfo.medallion);
        this.changeSetBuilder.setComment(this.commitInfo.comment);
        this.serialized = this.changeSetBuilder.serializeBinary();
        return this.commitInfo;
    }
}
